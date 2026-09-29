import { useCallback, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Project, Table } from '@shared/types'
import {
  historySnapshot,
  recordChange,
  redoSnapshot,
  subscribeToHistory,
  undoSnapshot
} from '@/lib/history'
import { patchTable, touchModifiedRecords } from '@/lib/ops'

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => window.api.getProject(id),
    staleTime: Infinity,
    // A missing project fails deterministically — there's nothing a retry
    // would find that the first read didn't.
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
const inflightSaves = new Set<Promise<void>>()

function persist(queryClient: QueryClient, id: string): void {
  const latest = queryClient.getQueryData<Project>(['project', id])
  if (!latest) return
  const save = window.api.saveProject(latest).finally(() => inflightSaves.delete(save))
  inflightSaves.add(save)
}

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
      persist(queryClient, id)
    }, 300)
  )
}

/** Sends every save still waiting out its debounce, and resolves once they —
 *  and any already on their way — have landed. The main process asks for this
 *  before a window closes, the app quits, or Save is pressed. */
export async function flushPendingSaves(queryClient: QueryClient): Promise<void> {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer)
    saveTimers.delete(id)
    persist(queryClient, id)
  }
  await Promise.allSettled([...inflightSaves])
}

/** Applies the document's new name (after Save As) to the cached project —
 *  not as an edit: it isn't undoable, and the file already has it. */
export function renameCachedProject(queryClient: QueryClient, id: string, name: string): void {
  queryClient.setQueryData<Project>(['project', id], (project) =>
    project ? { ...project, name } : project
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
      // Restored content gets a fresh timestamp because it was just changed.
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
