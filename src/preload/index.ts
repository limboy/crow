import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ConfirmDialogOptions, ContextMenuItem, Project } from '@shared/types'

const api: Api = {
  showContextMenu: (items: ContextMenuItem[]) => ipcRenderer.invoke('menu:popup', items),
  showConfirmDialog: (options: ConfirmDialogOptions) => ipcRenderer.invoke('dialog:confirm', options),
  newDocument: () => ipcRenderer.invoke('documents:new'),
  openDocument: (path?: string) => ipcRenderer.invoke('documents:open', path),
  getRecentDocuments: () => ipcRenderer.invoke('documents:recent'),
  getProject: (id: string) => ipcRenderer.invoke('projects:get', id),
  saveProject: (project: Project) => ipcRenderer.invoke('projects:save', project),
  onFlushRequest: (callback: () => Promise<void>) => {
    const listener = (_e: unknown, token: number): void => {
      // Answered whatever happens, so the main process never waits out its timeout.
      void callback()
        .catch(() => {})
        .finally(() => ipcRenderer.send('document:flushed', token))
    }
    ipcRenderer.on('document:flush', listener)
    return () => {
      ipcRenderer.removeListener('document:flush', listener)
    }
  },
  onDocumentRenamed: (callback: (name: string) => void) => {
    const listener = (_e: unknown, name: string): void => callback(name)
    ipcRenderer.on('document:renamed', listener)
    return () => {
      ipcRenderer.removeListener('document:renamed', listener)
    }
  },
  getLegacyProjectCount: () => ipcRenderer.invoke('legacy:count'),
  exportLegacyProjects: () => ipcRenderer.invoke('legacy:export'),
  exportCsv: (suggestedName: string, content: string) =>
    ipcRenderer.invoke('csv:export', suggestedName, content),
  importCsv: () => ipcRenderer.invoke('csv:import'),
  pickImage: (projectId: string) => ipcRenderer.invoke('images:pick', projectId),
  pickAudio: (projectId: string) => ipcRenderer.invoke('audio:pick', projectId),
  pickVideo: (projectId: string) => ipcRenderer.invoke('video:pick', projectId),
  saveImageAs: (url: string) => ipcRenderer.invoke('images:saveAs', url),
  saveAudioAs: (url: string) => ipcRenderer.invoke('audio:saveAs', url),
  saveVideoAs: (url: string) => ipcRenderer.invoke('video:saveAs', url),
  pickAttachments: (projectId: string) => ipcRenderer.invoke('attachments:pick', projectId),
  importImageData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('images:importData', projectId, name, data),
  importAudioData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('audio:importData', projectId, name, data),
  importVideoData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('video:importData', projectId, name, data),
  importAttachmentData: (projectId: string, name: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('attachments:importData', projectId, name, data),
  openAttachment: (url: string) => ipcRenderer.invoke('attachments:open', url),
  openVideo: (url: string) => ipcRenderer.invoke('video:open', url),
  saveAttachmentAs: (url: string, name: string) =>
    ipcRenderer.invoke('attachments:saveAs', url, name),
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
  }
}

contextBridge.exposeInMainWorld('api', api)
