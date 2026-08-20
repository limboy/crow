import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ConfirmDialogOptions, ContextMenuItem, Project } from '@shared/types'

const api: Api = {
  showContextMenu: (items: ContextMenuItem[]) => ipcRenderer.invoke('menu:popup', items),
  showConfirmDialog: (options: ConfirmDialogOptions) => ipcRenderer.invoke('dialog:confirm', options),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name: string) => ipcRenderer.invoke('projects:create', name),
  getProject: (id: string) => ipcRenderer.invoke('projects:get', id),
  saveProject: (project: Project) => ipcRenderer.invoke('projects:save', project),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  exportProject: (id: string) => ipcRenderer.invoke('projects:export', id),
  importProject: () => ipcRenderer.invoke('projects:import'),
  pickImage: (projectId: string) => ipcRenderer.invoke('images:pick', projectId),
  pickAudio: (projectId: string) => ipcRenderer.invoke('audio:pick', projectId),
  importImageData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('images:importData', projectId, name, data),
  importAudioData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('audio:importData', projectId, name, data),
  onProjectsChanged: (callback: () => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('projects:changed', listener)
    return () => {
      ipcRenderer.removeListener('projects:changed', listener)
    }
  },
  getUpdateStatus: () => ipcRenderer.invoke('updater:status'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateReady: (callback: (version: string) => void) => {
    const listener = (_e: unknown, version: string): void => callback(version)
    ipcRenderer.on('updater:ready', listener)
    return () => {
      ipcRenderer.removeListener('updater:ready', listener)
    }
  },
  getDataDir: () => ipcRenderer.invoke('settings:getDataDir'),
  pickDataDir: () => ipcRenderer.invoke('settings:pickDataDir'),
  setDataDir: (dir: string, move: boolean) => ipcRenderer.invoke('settings:setDataDir', dir, move)
}

contextBridge.exposeInMainWorld('api', api)
