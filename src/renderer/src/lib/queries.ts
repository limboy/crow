import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@shared/types'

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => window.api.listProjects() })
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

export type ProjectUpdater = (updater: (project: Project) => Project) => void

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Applies an update to the cached project immediately (so the UI is instant)
 * and persists the whole document with a short debounce so rapid edits like
 * typing in a cell collapse into one disk write.
 */
export function useUpdateProject(id: string): ProjectUpdater {
  const queryClient = useQueryClient()
  return useCallback(
    (updater: (project: Project) => Project) => {
      const current = queryClient.getQueryData<Project>(['project', id])
      if (!current) return
      const next = { ...updater(current), updatedAt: new Date().toISOString() }
      queryClient.setQueryData(['project', id], next)

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
    },
    [id, queryClient]
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
      queryClient.removeQueries({ queryKey: ['project', id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })
}
