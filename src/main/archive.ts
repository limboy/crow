import { createReadStream, promises as fs } from 'fs'
import { join } from 'path'
import { Unzip, UnzipInflate } from 'fflate'
import { migrateProject } from '@shared/migrate'
import type {
  LegacyProject,
  LegacyProjectBundle,
  Project,
  ProjectAssetKind,
  ProjectManifest
} from '@shared/types'

/**
 * Reader for the single-file `.crow` formats that came before the document
 * package: version 3 (a zip of `project.json` plus media) and versions 1–2
 * (one JSON document with base64'd media). Nothing writes these any more —
 * opening one converts it to a package (see `documents.ts`).
 */

const FORMAT = 'crow-project'
/** 1 = single implicit table (`fields`/`records`/`views` on the project),
 *  2 = `tables`,
 *  3 = zip archive rather than one JSON document with base64 assets inside. */
const VERSION = 3

/** Extension of a Crow document. */
export const BUNDLE_EXT = 'crow'

/** Name of the manifest entry inside the archive. Everything else in there is
 *  an asset, filed under the folder it belongs in. */
const MANIFEST_ENTRY = 'project.json'

/** Folder each kind of asset lives in — inside the archive, and inside the
 *  document package it's converted to. The two layouts are identical, so the
 *  names are spelled out rather than pluralized, which would give `audios/`. */
const ASSET_FOLDERS: Record<ProjectAssetKind, string> = {
  image: 'images',
  audio: 'audio',
  video: 'video',
  attachment: 'attachments'
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

/** Validates the manifest shared by both container formats. */
function parseManifest(raw: string): ProjectManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const bundle = parsed as Partial<ProjectManifest> | null
  if (bundle?.format !== FORMAT) throw new Error("That file isn't a Crow document.")
  if ((bundle.version ?? 0) > VERSION) {
    throw new Error('That file was made by a version of Crow this one can\'t read.')
  }
  const project = bundle.project as (Project & Partial<LegacyProject>) | undefined
  const hasTables = Array.isArray(project?.tables)
  const hasLegacyTable =
    Array.isArray(project?.fields) && Array.isArray(project?.records) && Array.isArray(project?.views)
  if (!project || typeof project.name !== 'string' || (!hasTables && !hasLegacyTable)) {
    throw new Error('That file has no readable project in it.')
  }
  return { ...(bundle as ProjectManifest), project: migrateProject(project) }
}

/** Maps an archive entry path to where it belongs under `targetDir`, or null
 *  for anything that isn't an asset we recognise — so `../../evil.png` can't
 *  escape. */
function assetTarget(entry: string, targetDir: string): { dir: string; file: string } | null {
  const slash = entry.indexOf('/')
  if (slash < 0) return null
  const folder = entry.slice(0, slash)
  const name = entry.slice(slash + 1)
  if (!Object.values(ASSET_FOLDERS).includes(folder) || !isSafeAssetName(name)) return null
  const dir = join(targetDir, folder)
  return { dir, file: join(dir, name) }
}

/**
 * Streams an archive, handing each entry to `onEntry` whole.
 *
 * One entry at a time is buffered, never the whole archive — which is the
 * point of the format: a project's attachments can add up to far more than
 * fits in memory, but any single one of them is bounded.
 */
async function readZip(
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
async function isZip(path: string): Promise<boolean> {
  const handle = await fs.open(path, 'r')
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0)
    return bytesRead === 4 && buffer.readUInt32BE(0) === 0x504b0304
  } finally {
    await handle.close()
  }
}

/**
 * Unpacks an old single-file document into `targetDir` — its assets into the
 * media folders there — and returns the project exactly as stored (migrated
 * to the current shape, with its own id and urls). `targetDir` is created.
 */
export async function extractArchive(path: string, targetDir: string): Promise<Project> {
  await fs.mkdir(targetDir, { recursive: true })

  if (await isZip(path)) {
    let manifest: ProjectManifest | undefined
    await readZip(path, async (entry, data) => {
      if (entry === MANIFEST_ENTRY) {
        manifest = parseManifest(Buffer.from(data).toString('utf-8'))
        return
      }
      const target = assetTarget(entry, targetDir)
      if (!target) return
      await fs.mkdir(target.dir, { recursive: true })
      await fs.writeFile(target.file, data)
    })
    if (!manifest) throw new Error(`That file has no ${MANIFEST_ENTRY} in it.`)
    return manifest.project
  }

  const manifest = parseManifest(await fs.readFile(path, 'utf-8'))
  for (const asset of (manifest as LegacyProjectBundle).assets ?? []) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.data !== 'string') continue
    if (!isSafeAssetName(asset.name)) continue
    const dir = join(targetDir, ASSET_FOLDERS[asset.kind] ?? ASSET_FOLDERS.image)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, asset.name), Buffer.from(asset.data, 'base64'))
  }
  return manifest.project
}
