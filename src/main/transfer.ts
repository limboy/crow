import { dialog, type BrowserWindow } from 'electron'
import { createReadStream, createWriteStream, promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { once } from 'events'
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { migrateProject } from '@shared/migrate'
import type {
  LegacyProject,
  LegacyProjectBundle,
  Project,
  ProjectAssetKind,
  ProjectManifest
} from '@shared/types'
import { getProject, saveProject } from './storage'
import { imagesDir } from './images'
import { audioDir } from './audio'
import { attachmentsDir } from './attachments'

const FORMAT = 'crow-project'
/** 1 = single implicit table (`fields`/`records`/`views` on the project),
 *  2 = `tables`,
 *  3 = zip archive rather than one JSON document with base64 assets inside.
 *  Versions 1 and 2 still import; they're migrated on the way in. */
const VERSION = 3

/** Extension of an exported archive. */
export const BUNDLE_EXT = 'crow'

/** Name of the manifest entry inside the archive. Everything else in there is
 *  an asset, filed under the folder it belongs in. */
const MANIFEST_ENTRY = 'project.json'

/** Where each kind of asset lives: `folder` inside the archive, `dir` in the
 *  project it's restored to. The two layouts are deliberately identical — an
 *  archive unzipped by hand drops straight into a project directory — so the
 *  names are spelled out rather than pluralized, which would give `audios/`. */
const ASSET_KINDS: Record<ProjectAssetKind, { folder: string; dir: (id: string) => string }> = {
  image: { folder: 'images', dir: imagesDir },
  audio: { folder: 'audio', dir: audioDir },
  attachment: { folder: 'attachments', dir: attachmentsDir }
}

/** Keeps a project or table name usable as a file name across platforms. */
export function toFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '-').trim()
  return cleaned || 'project'
}

/** Rejects anything that could escape the project's media folder. */
function isSafeAssetName(name: string): boolean {
  return /^[^/\\]+$/.test(name) && !name.startsWith('.')
}

/** Yields a project's asset files, one kind of folder at a time. Only the name
 *  is yielded — the bytes are read by the caller, as it writes each entry, so
 *  no more than one file is ever in memory. */
async function* readAssets(
  id: string
): AsyncGenerator<{ entry: string; path: string }> {
  for (const { folder, dir } of Object.values(ASSET_KINDS)) {
    const from = dir(id)
    let names: string[]
    try {
      names = await fs.readdir(from)
    } catch {
      continue // a project with no images/audio/attachments has no such folder
    }
    for (const name of names) {
      if (!isSafeAssetName(name)) continue
      yield { entry: `${folder}/${name}`, path: join(from, name) }
    }
  }
}

/**
 * Writes the archive: `project.json` plus every asset, each stored as itself.
 *
 * Assets go in uncompressed. They're overwhelmingly formats that are already
 * compressed (png, mp3, pdf, zip), so deflating them costs real time to save
 * almost nothing — and storing them means the bytes in the archive are the
 * bytes of the original file. The manifest is the one entry worth deflating:
 * it's the only large, repetitive text in there.
 */
async function writeArchive(path: string, manifest: ProjectManifest, id: string): Promise<void> {
  const out = createWriteStream(path)
  const zip = new Zip()
  let full = false
  let failure: Error | null = null

  const done = new Promise<void>((resolve, reject) => {
    out.on('error', reject)
    out.on('close', resolve)
    zip.ondata = (err, chunk, final): void => {
      if (err) {
        failure ??= err
        out.destroy(err)
        return
      }
      full = !out.write(chunk)
      if (final) out.end()
    }
  })

  /** fflate hands us output synchronously, so backpressure can only be applied
   *  between entries — which is enough, since entries are added one at a time. */
  const settle = async (): Promise<void> => {
    if (failure) throw failure
    if (full) {
      await once(out, 'drain')
      full = false
    }
  }

  try {
    const meta = new ZipDeflate(MANIFEST_ENTRY, { level: 6 })
    zip.add(meta)
    meta.push(Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'), true)
    await settle()

    for await (const asset of readAssets(id)) {
      let data: Buffer
      try {
        data = await fs.readFile(asset.path)
      } catch {
        continue // skip subdirectories and unreadable entries rather than failing
      }
      const entry = new ZipPassThrough(asset.entry)
      zip.add(entry)
      entry.push(data, true)
      await settle()
    }
    zip.end()
    await done
  } catch (err) {
    out.destroy()
    throw failure ?? err
  }
}

export async function exportProject(win: BrowserWindow | null, id: string): Promise<string | null> {
  const project = await getProject(id)
  const options = {
    title: 'Export project',
    defaultPath: `${toFileName(project.name)}.${BUNDLE_EXT}`,
    filters: [{ name: 'Crow project', extensions: [BUNDLE_EXT] }]
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null

  const manifest: ProjectManifest = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project
  }
  const tmp = `${result.filePath}.tmp`
  try {
    await writeArchive(tmp, manifest, id)
    await fs.rename(tmp, result.filePath)
  } catch (err) {
    // Never leave a half-written archive where the user asked for a whole one.
    await fs.rm(tmp, { force: true })
    throw err
  }
  return result.filePath
}

/** Validates the manifest shared by both container formats. */
function parseManifest(raw: string): ProjectManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const bundle = parsed as Partial<ProjectManifest> | null
  if (bundle?.format !== FORMAT) throw new Error("That file isn't a Crow project export.")
  if ((bundle.version ?? 0) > VERSION) {
    throw new Error('That export was made by a newer version of Crow.')
  }
  const project = bundle.project as (Project & Partial<LegacyProject>) | undefined
  const hasTables = Array.isArray(project?.tables)
  const hasLegacyTable =
    Array.isArray(project?.fields) && Array.isArray(project?.records) && Array.isArray(project?.views)
  if (!project || typeof project.name !== 'string' || (!hasTables && !hasLegacyTable)) {
    throw new Error('That export has no readable project in it.')
  }
  return { ...(bundle as ProjectManifest), project: migrateProject(project) }
}

/**
 * Points the project's `app-image://`/`app-audio://`/`app-attachment://` urls
 * at its new id. Done over the serialized project so it covers every place a
 * url can sit (record values of any shape) without walking the structure by
 * hand; external http urls are left alone because only the local schemes match.
 */
function remapAssetUrls(project: Project, fromId: string, toId: string): Project {
  if (fromId === toId) return project
  const remapped = JSON.stringify(project)
    .replaceAll(`app-image:///${fromId}/`, `app-image:///${toId}/`)
    .replaceAll(`app-audio:///${fromId}/`, `app-audio:///${toId}/`)
    .replaceAll(`app-attachment:///${fromId}/`, `app-attachment:///${toId}/`)
  return JSON.parse(remapped) as Project
}

/** Maps an archive entry path back to the project folder it belongs in, or
 *  null for anything that isn't an asset we recognise. The name is checked the
 *  same way a legacy bundle's is, so `../../evil.png` can't escape. */
function assetTarget(entry: string, id: string): { dir: string; file: string } | null {
  const slash = entry.indexOf('/')
  if (slash < 0) return null
  const folder = entry.slice(0, slash)
  const name = entry.slice(slash + 1)
  const kind = Object.values(ASSET_KINDS).find((k) => k.folder === folder)
  if (!kind || !isSafeAssetName(name)) return null
  const dir = kind.dir(id)
  return { dir, file: join(dir, name) }
}

/**
 * Streams an archive, handing each entry to `onEntry` whole.
 *
 * One entry at a time is buffered, never the whole archive — which is the
 * point of the format: a project's attachments can add up to far more than
 * fits in memory, but any single one of them is bounded.
 */
async function readArchive(
  path: string,
  onEntry: (entry: string, data: Uint8Array) => Promise<void>
): Promise<void> {
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  let pending: Promise<void> = Promise.resolve()
  let failure: Error | null = null

  unzip.onfile = (file): void => {
    const chunks: Uint8Array[] = []
    file.ondata = (err, chunk, final): void => {
      if (err) {
        failure ??= err
        return
      }
      if (chunk.length > 0) chunks.push(chunk)
      if (!final) return
      const data = Buffer.concat(chunks)
      chunks.length = 0
      pending = pending.then(() => onEntry(file.name, data))
    }
    file.start()
  }

  for await (const chunk of createReadStream(path)) {
    unzip.push(chunk as Uint8Array, false)
    if (failure) throw failure
    // Waited on per read chunk so a slow write can't let entries pile up.
    await pending
  }
  unzip.push(new Uint8Array(0), true)
  await pending
  if (failure) throw failure
}

/** Archives start with the local file header signature `PK\x03\x04`. Anything
 *  else is read as a version ≤2 JSON document. */
async function isArchive(path: string): Promise<boolean> {
  const handle = await fs.open(path, 'r')
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0)
    return bytesRead === 4 && buffer.readUInt32BE(0) === 0x504b0304
  } finally {
    await handle.close()
  }
}

/** Imports a bundle as a brand-new project, so importing the same file twice
 *  yields two independent projects instead of overwriting the first. */
export async function importProjectFromFile(path: string): Promise<Project> {
  const archive = await isArchive(path)
  const id = randomUUID()
  const now = new Date().toISOString()

  // The manifest is read on its own pass. Entry order is up to whoever wrote
  // the archive, and the assets can't be filed until the new id is known.
  let manifest: ProjectManifest | undefined
  if (archive) {
    await readArchive(path, async (entry, data) => {
      if (entry === MANIFEST_ENTRY) manifest = parseManifest(Buffer.from(data).toString('utf-8'))
    })
    if (!manifest) throw new Error(`That archive has no ${MANIFEST_ENTRY} in it.`)
  } else {
    manifest = parseManifest(await fs.readFile(path, 'utf-8'))
  }

  const project: Project = {
    ...remapAssetUrls(manifest.project, manifest.project.id, id),
    id,
    name: manifest.project.name.trim() || 'Untitled',
    createdAt: manifest.project.createdAt ?? now,
    updatedAt: now
  }

  if (archive) {
    await readArchive(path, async (entry, data) => {
      const target = assetTarget(entry, id)
      if (!target) return
      await fs.mkdir(target.dir, { recursive: true })
      await fs.writeFile(target.file, data)
    })
  } else {
    for (const asset of (manifest as LegacyProjectBundle).assets ?? []) {
      if (!asset || typeof asset.name !== 'string' || typeof asset.data !== 'string') continue
      if (!isSafeAssetName(asset.name)) continue
      const dir = (ASSET_KINDS[asset.kind] ?? ASSET_KINDS.image).dir(id)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(join(dir, asset.name), Buffer.from(asset.data, 'base64'))
    }
  }

  await saveProject(project)
  return project
}

export async function importProject(win: BrowserWindow | null): Promise<Project | null> {
  const options = {
    title: 'Import project',
    properties: ['openFile' as const],
    filters: [{ name: 'Crow project', extensions: [BUNDLE_EXT, 'json'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const source = result.filePaths[0]
  if (result.canceled || !source) return null

  try {
    return await importProjectFromFile(source)
  } catch (err) {
    // Reported here rather than thrown across IPC, so the renderer only has to
    // handle the same "nothing was imported" case as a cancelled dialog.
    const box = {
      type: 'error' as const,
      title: 'Import failed',
      message: "Couldn't import that project.",
      detail: err instanceof Error ? err.message : String(err)
    }
    if (win) await dialog.showMessageBox(win, box)
    else await dialog.showMessageBox(box)
    return null
  }
}
