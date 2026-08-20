import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import type { ConfirmDialogOptions, ContextMenuItem, Project } from '@shared/types'
import { createProject, deleteProject, ensureProjectsRootDir, getProject, listProjects, saveProject } from './storage'
import { importImageData, pickImage } from './images'
import { exportProject, importProject } from './transfer'
import { importAudioData, pickAudio } from './audio'
import { getReadyUpdateVersion, installReadyUpdate } from './updater'
import { defaultDataDir, getDataDir, setDataDir } from './config'
import { watchProjects } from './watcher'

export function registerIpc(): void {
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', (_e, name: string) => createProject(name))
  ipcMain.handle('projects:get', (_e, id: string) => getProject(id))
  ipcMain.handle('projects:save', (_e, project: Project) => saveProject(project))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('projects:export', (e, id: string) =>
    exportProject(BrowserWindow.fromWebContents(e.sender), id)
  )
  ipcMain.handle('projects:import', (e) => importProject(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('images:pick', (e, projectId: string) =>
    pickImage(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('images:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importImageData(projectId, name, data)
  )
  ipcMain.handle('audio:pick', (e, projectId: string) =>
    pickAudio(BrowserWindow.fromWebContents(e.sender), projectId)
  )
  ipcMain.handle('audio:importData', (_e, projectId: string, name: string, data: ArrayBuffer) =>
    importAudioData(projectId, name, data)
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
    const { title, message, detail, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive } = options
    // Cancel first/default so Enter/Return never confirms a destructive action by accident.
    const boxOptions = {
      type: destructive ? ('warning' as const) : ('question' as const),
      buttons: [cancelLabel, confirmLabel],
      defaultId: 0,
      cancelId: 0,
      title,
      message,
      detail
    }
    const result = win ? await dialog.showMessageBox(win, boxOptions) : await dialog.showMessageBox(boxOptions)
    return result.response === 1
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
