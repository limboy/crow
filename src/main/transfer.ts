import { dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { Project, ProjectBundle, ProjectBundleAsset } from '@shared/types'
import { getProject, saveProject } from './storage'
import { imagesDir } from './images'
import { audioDir } from './audio'

const FORMAT = 'crow-project'
const VERSION = 1

/** Extension of an exported bundle. It's plain JSON, so it stays as readable
 *  and agent-editable as the on-disk project files. */
export const BUNDLE_EXT = 'crow'

/** Keeps a project name usable as a file name across platforms. */
function toFileName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '-').trim()
  return cleaned || 'project'
}

/** Rejects anything that could escape the project's media folder. */
function isSafeAssetName(name: string): boolean {
  return /^[^/\\]+$/.test(name) && !name.startsWith('.')
}

async function readAssets(
  dir: string,
  kind: ProjectBundleAsset['kind']
): Promise<ProjectBundleAsset[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    // A project with no images/audio simply has no such folder.
    return []
  }
  const assets: ProjectBundleAsset[] = []
  for (const name of names) {
    if (!isSafeAssetName(name)) continue
    try {
      const data = await fs.readFile(join(dir, name))
      assets.push({ kind, name, data: data.toString('base64') })
    } catch {
      // Skip subdirectories and unreadable entries rather than failing the export.
    }
  }
  return assets
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

  const bundle: ProjectBundle = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project,
    assets: [
      ...(await readAssets(imagesDir(id), 'image')),
      ...(await readAssets(audioDir(id), 'audio'))
    ]
  }
  await fs.writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8')
  return result.filePath
}

function parseBundle(raw: string): ProjectBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const bundle = parsed as Partial<ProjectBundle> | null
  if (bundle?.format !== FORMAT) throw new Error("That file isn't a Crow project export.")
  if ((bundle.version ?? 0) > VERSION) {
    throw new Error('That export was made by a newer version of Crow.')
  }
  const project = bundle.project
  if (
    !project ||
    typeof project.name !== 'string' ||
    !Array.isArray(project.fields) ||
    !Array.isArray(project.records) ||
    !Array.isArray(project.views)
  ) {
    throw new Error('That export has no readable project in it.')
  }
  return { ...(bundle as ProjectBundle), project, assets: bundle.assets ?? [] }
}

/**
 * Points the project's `app-image://`/`app-audio://` urls at its new id.
 * Done over the serialized project so it covers every place a url can sit
 * (record values of any shape) without walking the structure by hand;
 * external http urls are left alone because only the local schemes match.
 */
function remapAssetUrls(project: Project, fromId: string, toId: string): Project {
  if (fromId === toId) return project
  const remapped = JSON.stringify(project)
    .replaceAll(`app-image:///${fromId}/`, `app-image:///${toId}/`)
    .replaceAll(`app-audio:///${fromId}/`, `app-audio:///${toId}/`)
  return JSON.parse(remapped) as Project
}

/** Imports a bundle as a brand-new project, so importing the same file twice
 *  yields two independent projects instead of overwriting the first. */
export async function importProjectFromFile(path: string): Promise<Project> {
  const bundle = parseBundle(await fs.readFile(path, 'utf-8'))
  const id = randomUUID()
  const now = new Date().toISOString()
  const project: Project = {
    ...remapAssetUrls(bundle.project, bundle.project.id, id),
    id,
    name: bundle.project.name.trim() || 'Untitled',
    createdAt: bundle.project.createdAt ?? now,
    updatedAt: now
  }

  for (const asset of bundle.assets) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.data !== 'string') continue
    if (!isSafeAssetName(asset.name)) continue
    const dir = asset.kind === 'audio' ? audioDir(id) : imagesDir(id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, asset.name), Buffer.from(asset.data, 'base64'))
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
