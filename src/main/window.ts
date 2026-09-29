import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'

const iconPath = join(__dirname, '../../build/icon.png')

/** Opens an app window on `route` — `/` for the welcome screen, or
 *  `/project/<id>` for an open document. */
export function createWindow(route = '/'): BrowserWindow {
  const focusedWin = BrowserWindow.getFocusedWindow()
  let bounds: { x?: number; y?: number } = {}
  if (focusedWin) {
    const [x, y] = focusedWin.getPosition()
    bounds = { x: x + 24, y: y + 24 }
  }

  const welcome = route === '/'
  const win = new BrowserWindow({
    width: welcome ? 720 : 1320,
    height: welcome ? 480 : 860,
    minWidth: welcome ? 560 : 960,
    minHeight: welcome ? 400 : 600,
    ...bounds,
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
  // The window title is the document's name, set by documents.ts — not
  // whatever the page's <title> says.
  win.on('page-title-updated', (e) => e.preventDefault())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const appUrl = devUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString()

  // The preload — and with it the whole `window.api` bridge — attaches to
  // whatever this window loads, in any frame. So nothing but the app's own
  // document may ever become a navigation here: a .crow file can carry an
  // arbitrary html file as an attachment, and rendering that in this window
  // would hand it read/write access to the open document. Anything else is a
  // link the user meant to follow, which belongs to the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(appUrl)) return
    e.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
  })

  win.loadURL(`${appUrl}#${route}`)
  return win
}
