import { promises as fs } from 'fs'
import { join } from 'path'
import { migrateProject } from '@shared/migrate'
import type { LegacyProject, Project } from '@shared/types'

export const SAFE_ID = /^[a-zA-Z0-9-]+$/

export const DATA_FILE = 'data.json'

/** The media folders inside a document, and the url scheme each one's files
 *  are referenced by from inside the project. */
export const MEDIA_FOLDERS: Record<string, string> = {
  images: 'app-image',
  audio: 'app-audio',
  video: 'app-video',
  attachments: 'app-attachment'
}

/**
 * A `.crow` document is a directory — a package, which Finder shows as a
 * single file:
 *
 *   Name.crow/
 *   ├── data.json      the project
 *   ├── images/ audio/ video/ attachments/
 *
 * Everything reads and writes inside it directly. Media is referenced as
 * `app-image:///<projectId>/<name>` (etc.), so the protocol handlers need to
 * know which directory each open project id lives in; that's this map.
 */
const openDirs = new Map<string, string>()

export function registerProjectDir(id: string, dir: string): void {
  openDirs.set(id, dir)
}

export function unregisterProjectDir(id: string): void {
  openDirs.delete(id)
  savedMtimes.delete(id)
}

export function isProjectOpen(id: string): boolean {
  return openDirs.has(id)
}

/** The directory of an open document. Throws for any id that isn't one, so a
 *  renderer can only ever read or write the documents actually open. */
export function projectDir(id: string): string {
  const dir = openDirs.get(id)
  if (!dir) throw new Error(`No open document has id ${id}`)
  return dir
}

/** Reads a document's project, migrated to the current shape. Throws if the
 *  directory doesn't hold a readable one. */
export async function readProjectAt(dir: string): Promise<Project> {
  let parsed: (Project & Partial<LegacyProject>) | null
  try {
    parsed = JSON.parse(await fs.readFile(join(dir, DATA_FILE), 'utf-8'))
  } catch {
    throw new Error(`There's no readable ${DATA_FILE} in it.`)
  }
  const hasTables = Array.isArray(parsed?.tables)
  const hasLegacyTable =
    Array.isArray(parsed?.fields) && Array.isArray(parsed?.records) && Array.isArray(parsed?.views)
  if (!parsed || typeof parsed.name !== 'string' || (!hasTables && !hasLegacyTable)) {
    throw new Error(`Its ${DATA_FILE} isn't a Crow project.`)
  }
  return migrateProject(parsed)
}

/** Writes `data.json` atomically: beside it first, then renamed over it. */
export async function writeProjectAt(dir: string, project: Project): Promise<number> {
  const target = join(dir, DATA_FILE)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf-8')
  await fs.rename(tmp, target)
  return (await fs.stat(target)).mtimeMs
}

// mtime of each open document's data.json as this process last wrote it, so
// the watcher can tell our own saves from someone else's (e.g. the CLI).
const savedMtimes = new Map<string, number>()

export function wasSavedByUs(id: string, mtime: number): boolean {
  return savedMtimes.get(id) === mtime
}

export async function getProject(id: string): Promise<Project> {
  return readProjectAt(projectDir(id))
}

export async function saveProject(project: Project): Promise<void> {
  savedMtimes.set(project.id, await writeProjectAt(projectDir(project.id), project))
}

/**
 * Points the project's `app-*:///` urls at a new id. Done over the serialized
 * project so it covers every place a url can sit without walking the
 * structure by hand; external http urls don't match.
 */
export function remapAssetUrls(project: Project, fromId: string, toId: string): Project {
  if (fromId === toId) return { ...project, id: toId }
  let remapped = JSON.stringify(project)
  for (const scheme of Object.values(MEDIA_FOLDERS)) {
    remapped = remapped.replaceAll(`${scheme}:///${fromId}/`, `${scheme}:///${toId}/`)
  }
  return { ...(JSON.parse(remapped) as Project), id: toId }
}

/** Every `<folder>/<name>` the serialized project points at. */
function referencedMedia(serialized: string): Set<string> {
  const referenced = new Set<string>()
  for (const [folder, scheme] of Object.entries(MEDIA_FOLDERS)) {
    for (const [, name] of serialized.matchAll(new RegExp(`${scheme}:///[^/"]+/([^"?#]+)`, 'g'))) {
      let decoded = name
      try {
        decoded = decodeURIComponent(name)
      } catch {
        // malformed escape: match it literally rather than sweeping it
      }
      referenced.add(`${folder}/${decoded}`)
    }
  }
  return referenced
}

/** Files younger than this are never swept: the CLI copies a file in before
 *  it writes the data.json that references it. */
const SWEEP_GRACE_MS = 60 * 1000

/**
 * Deletes media files the document no longer references.
 *
 * Run when a window closes, not on every save: while the window is open, an
 * undo can put a removed image back, and its file has to still be there.
 * Undo history ends with the window, and after that an unreferenced file has
 * no way back — keeping it would only make the document grow forever.
 */
export async function sweepUnreferencedMedia(dir: string): Promise<void> {
  let serialized: string
  try {
    serialized = await fs.readFile(join(dir, DATA_FILE), 'utf-8')
  } catch {
    return // no readable project: sweeping against it would delete everything
  }
  const referenced = referencedMedia(serialized)
  const cutoff = Date.now() - SWEEP_GRACE_MS
  for (const folder of Object.keys(MEDIA_FOLDERS)) {
    let names: string[]
    try {
      names = await fs.readdir(join(dir, folder))
    } catch {
      continue
    }
    for (const name of names) {
      if (referenced.has(`${folder}/${name}`)) continue
      const path = join(dir, folder, name)
      try {
        const stat = await fs.stat(path)
        if (!stat.isFile() || stat.mtimeMs > cutoff) continue
        await fs.rm(path, { force: true })
      } catch {
        // unreadable or already gone — leave it
      }
    }
  }
}
