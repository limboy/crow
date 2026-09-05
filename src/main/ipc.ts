import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { ConfirmDialogOptions, ContextMenuItem, Project } from '@shared/types'
import {
  createProject,
  deleteProject,
  ensureProjectsRootDir,
  getProject,
  listProjects,
  saveProject,
  saveProjectOrder
} from './storage'
import { importImageData, pickImage, saveImageAs } from './images'
import { exportProject, importProject } from './transfer'
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
import { defaultDataDir, getDataDir, setDataDir } from './config'
import { watchProjects } from './watcher'

function broadcastToOthers(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== sender) {
      win.webContents.send(channel, ...args)
    }
  }
}

export function registerIpc(): void {
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', async (e, name: string) => {
    const project = await createProject(name)
    broadcastToOthers(e.sender, 'projects:changed')
    return project
  })
  ipcMain.handle('projects:get', (_e, id: string) => getProject(id))
  ipcMain.handle('projects:save', async (e, project: Project) => {
    const saved = await saveProject(project)
    broadcastToOthers(e.sender, 'projects:changed')
    return saved
  })
  ipcMain.handle('projects:delete', async (e, id: string) => {
    const res = await deleteProject(id)
    broadcastToOthers(e.sender, 'projects:changed')
    return res
  })
  ipcMain.handle('projects:setOrder', async (e, ids: string[]) => {
    const res = await saveProjectOrder(ids)
    broadcastToOthers(e.sender, 'projects:changed')
    return res
  })
  ipcMain.handle('projects:export', (e, id: string) =>
    exportProject(BrowserWindow.fromWebContents(e.sender), id)
  )
  ipcMain.handle('projects:import', async (e) => {
    const project = await importProject(BrowserWindow.fromWebContents(e.sender))
    if (project) broadcastToOthers(e.sender, 'projects:changed')
    return project
  })
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

  ipcMain.handle('settings:getDataDir', () => ({
    current: getDataDir(),
    default: defaultDataDir()
  }))

  ipcMain.handle('settings:pickDataDir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('settings:setDataDir', async (_e, dir: string, move: boolean) => {
    await setDataDir(dir, { move })
    // The move:false path points at a folder that may not exist yet, which
    // would make the watcher below throw.
    await ensureProjectsRootDir()
    watchProjects()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('projects:changed')
    }
  })
}
