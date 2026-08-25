import { promises as fs } from 'fs'
import { join } from 'path'
import { newProject } from '@shared/defaults'
import { migrateProject, projectRecordCount } from '@shared/migrate'
import type { LegacyProject, Project, ProjectMeta } from '@shared/types'
import { getDataDir } from './config'

export const SAFE_ID = /^[a-zA-Z0-9-]+$/

export const DATA_FILE = 'data.json'

export const projectsRootDir = (): string => join(getDataDir(), 'projects')

/** Each project lives in its own folder: `<dataDir>/projects/<id>/data.json`,
 * with any images/audio it owns alongside it (`.../<id>/images/…`), so a
 * project can be copied, backed up, or deleted as a single self-contained
 * directory. */
export function projectDir(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid project id: ${id}`)
  return join(projectsRootDir(), id)
}

function projectFile(id: string): string {
  return join(projectDir(id), DATA_FILE)
}

// Timestamps of writes made by this process, so the directory watcher can
// tell the app's own saves apart from external ones (e.g. the agent CLI).
const selfWrites = new Map<string, number>()

export function wasRecentSelfWrite(filename: string): boolean {
  const at = selfWrites.get(filename)
  return at !== undefined && Date.now() - at < 1000
}

export async function ensureProjectsRootDir(): Promise<void> {
  await fs.mkdir(projectsRootDir(), { recursive: true })
}

export async function listProjectIds(): Promise<string[]> {
  await ensureProjectsRootDir()
  const entries = await fs.readdir(projectsRootDir(), { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && SAFE_ID.test(e.name)).map((e) => e.name)
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const ids = await listProjectIds()
  const metas: ProjectMeta[] = []
  for (const id of ids) {
    try {
      const raw = await fs.readFile(projectFile(id), 'utf-8')
      const p = migrateProject(JSON.parse(raw) as Project | LegacyProject)
      metas.push({
        id: p.id,
        name: p.name,
        icon: p.icon,
        recordCount: projectRecordCount(p),
        tableCount: p.tables.length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })
    } catch {
      // skip unreadable files rather than failing the whole list
    }
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Projects are migrated on the way out rather than rewritten in place, so an
 *  older file is only upgraded on disk once the user actually edits it. */
export async function getProject(id: string): Promise<Project> {
  const raw = await fs.readFile(projectFile(id), 'utf-8')
  return migrateProject(JSON.parse(raw) as Project | LegacyProject)
}

/** How long an unreferenced attachment is kept before it's swept. Anything
 *  younger is left alone, which covers the two cases where "unreferenced" is
 *  only momentarily true: an undo of the removal that put it back, and a file
 *  the CLI has written but whose own save hasn't landed yet. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

/**
 * Deletes attachment files the saved project no longer points at.
 *
 * Images and audio are deliberately left alone — they're bounded in practice
 * and the format doc promises an export never drops one. An attachment can be
 * any file at all, so a store that only ever grows isn't tenable: removing a
 * 2GB file from a cell has to eventually give the 2GB back.
 */
async function sweepAttachments(id: string, serialized: string): Promise<void> {
  const dir = join(projectDir(id), 'attachments')
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return // no attachments folder, nothing to sweep
  }
  const referenced = new Set<string>()
  for (const [, name] of serialized.matchAll(/app-attachment:\/\/\/[^/"]+\/([^"?#]+)/g)) {
    try {
      referenced.add(decodeURIComponent(name))
    } catch {
      referenced.add(name) // malformed escape: match it literally rather than sweeping it
    }
  }
  const cutoff = Date.now() - ORPHAN_GRACE_MS
  for (const name of names) {
    if (referenced.has(name)) continue
    try {
      const stat = await fs.stat(join(dir, name))
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue
      await fs.rm(join(dir, name), { force: true })
    } catch {
      // Unreadable or already gone — leave it rather than failing the save.
    }
  }
}

export async function saveProject(project: Project): Promise<void> {
  await fs.mkdir(projectDir(project.id), { recursive: true })
  const target = projectFile(project.id)
  const tmp = `${target}.tmp`
  const watchKey = `${project.id}/${DATA_FILE}`
  const serialized = JSON.stringify(project, null, 2)
  selfWrites.set(watchKey, Date.now())
  await fs.writeFile(tmp, serialized, 'utf-8')
  await fs.rename(tmp, target)
  selfWrites.set(watchKey, Date.now())
  // After the rename, so a sweep can only ever run against what's on disk.
  await sweepAttachments(project.id, serialized).catch((err) =>
    console.error('[saveProject] attachment sweep failed', err)
  )
}

export async function createProject(name: string): Promise<Project> {
  const project = newProject(name.trim() || 'Untitled')
  await saveProject(project)
  return project
}

export async function deleteProject(id: string): Promise<void> {
  selfWrites.set(`${id}/${DATA_FILE}`, Date.now())
  await fs.rm(projectDir(id), { recursive: true, force: true })
}
