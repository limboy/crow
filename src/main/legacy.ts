import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, promises as fs, readFileSync } from 'fs'
import { join } from 'path'
import { migrateProject } from '@shared/migrate'
import type { LegacyProject, Project } from '@shared/types'
import { BUNDLE_EXT, toFileName } from './archive'
import { SAFE_ID } from './storage'

/**
 * Versions before 3.0 kept every project in one app-managed data folder
 * (`<dataDir>/projects/<id>/data.json`, with its media alongside), and let the
 * user move that folder. Crow now only works with `.crow` documents, so this
 * module exists to get those projects out: it finds the old folder the same
 * way the old app did, and copies each project in it out as a document. Each
 * old project folder is already laid out exactly like a document package, so
 * a copy with a `.crow` name is all it takes.
 */
function legacyProjectsDir(): string {
  const userData = app.getPath('userData')
  try {
    const config = JSON.parse(readFileSync(join(userData, 'config.json'), 'utf-8')) as {
      dataDir?: unknown
    }
    if (typeof config.dataDir === 'string' && existsSync(config.dataDir)) {
      return join(config.dataDir, 'projects')
    }
  } catch {
    // no config.json, or unreadable — the default location it is
  }
  return join(userData, 'projects')
}

async function readLegacyProjects(): Promise<{ dir: string; project: Project }[]> {
  const root = legacyProjectsDir()
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const projects: { dir: string; project: Project }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue
    const dir = join(root, entry.name)
    try {
      const raw = await fs.readFile(join(dir, 'data.json'), 'utf-8')
      projects.push({ dir, project: migrateProject(JSON.parse(raw) as Project | LegacyProject) })
    } catch {
      // skip unreadable projects rather than failing the whole list
    }
  }
  return projects
}

export async function countLegacyProjects(): Promise<number> {
  return (await readLegacyProjects()).length
}

/** A name in `dir` that isn't taken yet: `Name.crow`, `Name 2.crow`, … */
function freePath(dir: string, name: string, taken: Set<string>): string {
  const base = toFileName(name)
  for (let n = 1; ; n++) {
    const file = `${n === 1 ? base : `${base} ${n}`}.${BUNDLE_EXT}`
    const path = join(dir, file)
    if (!taken.has(path) && !existsSync(path)) {
      taken.add(path)
      return path
    }
  }
}

/**
 * Writes every old project into a folder the user picks, one `.crow` file
 * each, then sets the old data folder aside (renamed, not deleted) so the
 * offer doesn't come back. Resolves true once the export is done.
 */
export async function exportLegacyProjects(win: BrowserWindow | null): Promise<boolean> {
  const projects = await readLegacyProjects()
  if (projects.length === 0) return false

  const options = {
    title: 'Export Projects',
    message: 'Choose a folder to save your projects in, one .crow document each.',
    buttonLabel: 'Export Here',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory' as const, 'createDirectory' as const]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const folder = result.filePaths[0]
  if (result.canceled || !folder) return false

  const taken = new Set<string>()
  const failures: string[] = []
  for (const { dir, project } of projects) {
    try {
      await fs.cp(dir, freePath(folder, project.name, taken), { recursive: true })
    } catch (err) {
      failures.push(`${project.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures.length > 0) {
    const box = {
      type: 'error' as const,
      message: `Couldn't export ${failures.length} of ${projects.length} projects.`,
      detail: `${failures.join('\n')}\n\nYour original projects haven't been touched.`
    }
    if (win) await dialog.showMessageBox(win, box)
    else await dialog.showMessageBox(box)
    return false
  }

  const root = legacyProjectsDir()
  let aside = `${root}-exported`
  for (let n = 2; existsSync(aside); n++) aside = `${root}-exported-${n}`
  await fs.rename(root, aside).catch((err) => {
    console.warn('[legacy] could not set the old projects folder aside', err)
  })
  void shell.openPath(folder)
  return true
}
