import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { installCli } from './cli'

/**
 * Application menu supporting macOS, Windows, and Linux:
 * - macOS: App menu (with "Install 'crow' Command in PATH"), File (New Window, Close Window), Edit, View, Window
 * - Windows / Linux: File (New Window, Exit), Edit, View, Window
 */
export function buildAppMenu(onNewWindow: () => void): Menu {
  const isMac = process.platform === 'darwin'

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
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            onNewWindow()
          }
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
