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

export async function saveProject(project: Project): Promise<void> {
  await fs.mkdir(projectDir(project.id), { recursive: true })
  const target = projectFile(project.id)
  const tmp = `${target}.tmp`
  const watchKey = `${project.id}/${DATA_FILE}`
  selfWrites.set(watchKey, Date.now())
  await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf-8')
  await fs.rename(tmp, target)
  selfWrites.set(watchKey, Date.now())
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
