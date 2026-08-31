import { useCallback, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Project, ProjectMeta, Table } from '@shared/types'
import {
  clearHistory,
  historySnapshot,
  recordChange,
  redoSnapshot,
  subscribeToHistory,
  undoSnapshot
} from '@/lib/history'
import { patchTable, touchModifiedRecords } from '@/lib/ops'

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => window.api.listProjects() })
}

export function useSetProjectOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ordered: ProjectMeta[]) =>
      window.api.setProjectOrder(ordered.map((project) => project.id)),
    onMutate: (ordered) => {
      const previous = queryClient.getQueryData<ProjectMeta[]>(['projects'])
      queryClient.setQueryData(['projects'], ordered)
      return { previous }
    },
    onError: (_error, _ordered, context) => {
      if (context?.previous) queryClient.setQueryData(['projects'], context.previous)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => window.api.getProject(id),
    staleTime: Infinity,
    // A missing project (deleted, or the data folder changed out from under
    // us) fails deterministically — retrying just delays ProjectPage's
    // fallback-navigation from noticing it's gone.
    retry: false
  })
}

export interface EditOptions {
  /** Marks this edit as a continuation of the same user action — typing in
   *  one field, dragging one slider — so a run of them undoes as a single
   *  step. See lib/history.ts. */
  coalesceKey?: string
}

export type ProjectUpdater = (
  updater: (project: Project) => Project,
  options?: EditOptions
) => void

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Publishes a new version of the project: cached immediately (so the UI is
 *  instant), then persisted whole with a short debounce so rapid edits like
 *  typing in a cell collapse into one disk write. */
function commitProject(queryClient: QueryClient, id: string, project: Project): void {
  queryClient.setQueryData(['project', id], project)

  const pending = saveTimers.get(id)
  if (pending) clearTimeout(pending)
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id)
      const latest = queryClient.getQueryData<Project>(['project', id])
      if (!latest) return
      void window.api
        .saveProject(latest)
        .then(() => queryClient.invalidateQueries({ queryKey: ['projects'] }))
    }, 300)
  )
}

/**
 * Applies an update to the cached project and records the pre-edit state so
 * the edit can be undone. Updates that change nothing — ops return the very
 * same project when an edit doesn't apply — are dropped here, so they neither
 * touch the disk nor leave a no-op step in the history.
 */
export function useUpdateProject(id: string): ProjectUpdater {
  const queryClient = useQueryClient()
  return useCallback(
    (updater: (project: Project) => Project, options?: EditOptions) => {
      const current = queryClient.getQueryData<Project>(['project', id])
      if (!current) return
      const updated = updater(current)
      if (updated === current) return
      recordChange(id, current, options?.coalesceKey)
      const now = new Date().toISOString()
      commitProject(queryClient, id, {
        ...touchModifiedRecords(current, updated, now),
        updatedAt: now
      })
    },
    [id, queryClient]
  )
}

export interface ProjectHistory {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/** Undo/redo for the project as a whole — one history per project, shared by
 *  every table and view inside it, since that's the unit that gets saved. */
export function useProjectHistory(id: string): ProjectHistory {
  const queryClient = useQueryClient()
  const snapshot = useSyncExternalStore(subscribeToHistory, () => historySnapshot(id))
  const [pastCount, futureCount] = snapshot.split(':')

  const step = useCallback(
    (take: (id: string, current: Project) => Project | undefined) => {
      const current = queryClient.getQueryData<Project>(['project', id])
      if (!current) return
      const restored = take(id, current)
      if (!restored) return
      // Restored content gets a fresh timestamp because it was just changed,
      // even when the user has manually ordered the project list.
      commitProject(queryClient, id, { ...restored, updatedAt: new Date().toISOString() })
    },
    [id, queryClient]
  )

  return {
    undo: useCallback(() => step(undoSnapshot), [step]),
    redo: useCallback(() => step(redoSnapshot), [step]),
    canUndo: pastCount !== '0',
    canRedo: futureCount !== '0'
  }
}

export type TableUpdater = (updater: (table: Table) => Table, options?: EditOptions) => void

/**
 * The updater every view and record editor works through: they only ever
 * touch one table, so they don't have to know they live inside a project.
 * Saving is still whole-project, via useUpdateProject.
 */
export function useUpdateTable(projectId: string, tableId: string): TableUpdater {
  const update = useUpdateProject(projectId)
  return useCallback(
    (updater: (table: Table) => Table, options?: EditOptions) =>
      update((p) => patchTable(p, tableId, updater), options),
    [update, tableId]
  )
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.api.createProject(name),
    onSuccess: (project) => {
      queryClient.setQueryData(['project', project.id], project)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })
}

/** Resolves with the newly imported project, or null if the user cancelled
 *  (or the file was rejected — the main process reports that itself). */
export function useImportProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => window.api.importProject(),
    onSuccess: (project) => {
      if (!project) return
      queryClient.setQueryData(['project', project.id], project)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.api.deleteProject(id),
    onSuccess: (_data, id) => {
      clearHistory(id)
      queryClient.removeQueries({ queryKey: ['project', id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })
}
