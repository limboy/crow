import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { ConfirmDialogOptions, ContextMenuItem, Project } from '@shared/types'
import { saveProject } from './storage'
import { importImageData, pickImage, saveImageAs } from './images'
import { exportCsv, importCsv } from './csv'
import { importAudioData, pickAudio, saveAudioAs } from './audio'
import { importVideoData, openVideo, pickVideo, saveVideoAs } from './video'
import {
  importAttachmentData,
  openAttachment,
  pickAttachments,
  saveAttachmentAs
} from './attachments'
import { getReadyUpdateVersion, installReadyUpdate } from './updater'
import { getDocumentProject, registerDocumentIpc } from './documents'
import { countLegacyProjects, exportLegacyProjects } from './legacy'

export function registerIpc(): void {
  registerDocumentIpc()
  ipcMain.handle('projects:get', (_e, id: string) => getDocumentProject(id))
  ipcMain.handle('projects:save', (_e, project: Project) => saveProject(project))
  ipcMain.handle('legacy:count', () => countLegacyProjects())
  ipcMain.handle('legacy:export', (e) =>
    exportLegacyProjects(BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle('csv:export', (e, suggestedName: string, content: string) =>
    exportCsv(BrowserWindow.fromWebContents(e.sender), suggestedName, content)
  )
  ipcMain.handle('csv:import', (e) => importCsv(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('images:pick', (e, projectId: string) =>
    pickImage(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('images:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importImageData(projectId, name, data)
  )
  ipcMain.handle('images:saveAs', (e, url: string) =>
    saveImageAs(BrowserWindow.fromWebContents(e.sender), url)
  )
  ipcMain.handle('audio:pick', (e, projectId: string) =>
    pickAudio(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('audio:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importAudioData(projectId, name, data)
  )
  ipcMain.handle('audio:saveAs', (e, url: string) =>
    saveAudioAs(BrowserWindow.fromWebContents(e.sender), url)
  )
  ipcMain.handle('video:pick', (e, projectId: string) =>
    pickVideo(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('video:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importVideoData(projectId, name, data)
  )
  ipcMain.handle('video:saveAs', (e, url: string) =>
    saveVideoAs(BrowserWindow.fromWebContents(e.sender), url)
  )
  ipcMain.handle('video:open', (_e, url: string) => openVideo(url))
  ipcMain.handle('attachments:pick', (e, projectId: string) =>
    pickAttachments(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('attachments:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importAttachmentData(projectId, name, data)
  )
  ipcMain.handle('attachments:open', (_e, url: string) => openAttachment(url))
  ipcMain.handle('attachments:saveAs', (e, url: string, name: string) =>
    saveAttachmentAs(BrowserWindow.fromWebContents(e.sender), url, name)
  )
  ipcMain.handle('updater:status', () => getReadyUpdateVersion())
  ipcMain.handle('updater:install', () => installReadyUpdate())

  ipcMain.handle('menu:popup', (e, items: ContextMenuItem[]) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    return new Promise<string | null>((resolve) => {
      let resolved = false
      const settle = (id: string | null): void => {
        if (resolved) return
        resolved = true
        resolve(id)
      }
      const menu = Menu.buildFromTemplate(
        items.map((item) =>
          item.type === 'separator'
            ? { type: 'separator' as const }
            : { label: item.label, click: () => settle(item.id) }
        )
      )
      menu.popup({ window: win, callback: () => settle(null) })
    })
  })

  ipcMain.handle('dialog:confirm', async (e, options: ConfirmDialogOptions) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const {
      title,
      message,
      detail,
      confirmLabel = 'OK',
      cancelLabel = 'Cancel',
      destructive,
      alert
    } = options
    // Cancel first/default so Enter/Return never confirms a destructive action by accident.
    const boxOptions = alert
      ? {
          type: destructive ? ('warning' as const) : ('info' as const),
          buttons: [confirmLabel],
          defaultId: 0,
          cancelId: 0,
          title,
          message,
          detail
        }
      : {
          type: destructive ? ('warning' as const) : ('question' as const),
          buttons: [cancelLabel, confirmLabel],
          defaultId: 0,
          cancelId: 0,
          title,
          message,
          detail
        }
    const result = win ? await dialog.showMessageBox(win, boxOptions) : await dialog.showMessageBox(boxOptions)
    return !alert && result.response === 1
  })
}
