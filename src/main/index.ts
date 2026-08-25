import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './images'
import { registerAudioProtocol } from './audio'
import { registerAttachmentProtocol } from './attachments'
import { seedIfEmpty } from './seed'
import { watchProjects } from './watcher'
import { initAutoUpdater } from './updater'
import { buildAppMenu } from './menu'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-image', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'app-audio', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'app-attachment', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

const iconPath = join(__dirname, '../../build/icon.png')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: { x: 16, y: 16 },
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const appUrl = devUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

  // The preload — and with it the whole `window.api` bridge — attaches to
  // whatever this window loads, in any frame. So nothing but the app's own
  // document may ever become a navigation here: an imported .crow can carry an
  // arbitrary html file as an attachment, and rendering that in this window
  // would hand it read/write access to every project. Anything else is a link
  // the user meant to follow, which belongs to the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(appUrl)) return
    e.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
  })

  win.loadURL(appUrl)
}

app.whenReady().then(async () => {
  // Adds "Install 'crow' Command in PATH" to Electron's default mac menu;
  // other platforms keep the built-in default (CLI install isn't wired up
  // there yet — see src/main/cli.ts).
  if (process.platform === 'darwin') Menu.setApplicationMenu(buildAppMenu())

  registerImageProtocol()
  registerAudioProtocol()
  registerAttachmentProtocol()
  registerIpc()
  await seedIfEmpty()
  watchProjects()
  createWindow()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
