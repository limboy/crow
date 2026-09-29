import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { installCli } from './cli'
import {
  clearRecentDocuments,
  getRecentDocuments,
  newDocument,
  openDocument,
  openDocumentDialog,
  saveDocument,
  saveDocumentAs
} from './documents'

/**
 * Application menu supporting macOS, Windows, and Linux:
 * - macOS: App menu (with "Install 'crow' Command in PATH"), File, Edit, View, Window
 * - Windows / Linux: File, Edit, View, Window
 *
 * File works on documents: New… / Open… / Open Recent, Save / Save As… for the
 * focused one. Rebuild it (via `refreshAppMenu`) whenever the recent list changes.
 */
export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const focused = (): BrowserWindow | null => BrowserWindow.getFocusedWindow()
  const recent = getRecentDocuments()

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: "Install 'crow' Command in PATH",
                click: () => {
                  void installCli()
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New…',
          accelerator: 'CmdOrCtrl+N',
          click: () => void newDocument(focused())
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void openDocumentDialog(focused())
        },
        {
          label: 'Open Recent',
          submenu: [
            ...recent.map((doc) => ({
              label: doc.name,
              toolTip: doc.path,
              click: () => void openDocument(doc.path)
            })),
            ...(recent.length > 0 ? [{ type: 'separator' as const }] : []),
            {
              label: 'Clear Menu',
              enabled: recent.length > 0,
              click: () => clearRecentDocuments()
            }
          ]
        },
        { type: 'separator' as const },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => void saveDocument(focused())
        },
        {
          label: 'Save As…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => void saveDocumentAs(focused())
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const }
  ]
  return Menu.buildFromTemplate(template)
}

export function refreshAppMenu(): void {
  Menu.setApplicationMenu(buildAppMenu())
}
