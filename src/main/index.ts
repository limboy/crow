import { app, protocol } from 'electron'
import { existsSync } from 'fs'
import { extname } from 'path'
import { registerIpc } from './ipc'
import { registerImageProtocol } from './images'
import { registerAudioProtocol } from './audio'
import { registerVideoProtocol } from './video'
import { registerAttachmentProtocol } from './attachments'
import { initAutoUpdater } from './updater'
import { refreshAppMenu } from './menu'
import { BUNDLE_EXT } from './archive'
import {
  hasOpenDocuments,
  openDocument,
  setRecentListener,
  settleAll,
  showWelcome
} from './documents'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-image', privileges: { secure: true, supportFetchAPI: true, stream: true } },
  // `corsEnabled` so the renderer can fetch a clip whole and play it from a
  // blob; see AudioPlayer.
  {
    scheme: 'app-audio',
    privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  },
  // `corsEnabled` on video alone: the cover frame is captured by drawing the
  // video into a canvas, and a canvas drawn from a foreign origin can't be
  // exported. The handler answers with `access-control-allow-origin`, so the
  // frame comes out readable.
  {
    scheme: 'app-video',
    privileges: { secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  },
  { scheme: 'app-attachment', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

/** `.crow` paths in a command line — how Windows and Linux hand the app a
 *  double-clicked file, on first launch and (via second-instance) after. */
function documentArgs(argv: string[]): string[] {
  return argv.filter(
    (arg) => !arg.startsWith('-') && extname(arg).toLowerCase() === `.${BUNDLE_EXT}` && existsSync(arg)
  )
}

// One process owns every open document, so a second launch just hands its
// files to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let ready = false
  // macOS delivers files opened from Finder through open-file, which can fire
  // before the app is ready — those wait here until it is.
  const pending: string[] = documentArgs(process.argv.slice(1))

  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (ready) void openDocument(path)
    else pending.push(path)
  })

  app.on('second-instance', (_e, argv) => {
    const files = documentArgs(argv.slice(1))
    if (files.length > 0) for (const path of files) void openDocument(path)
    else if (!hasOpenDocuments()) showWelcome()
  })

  app.whenReady().then(async () => {
    setRecentListener(refreshAppMenu)
    refreshAppMenu()
    registerImageProtocol()
    registerAudioProtocol()
    registerVideoProtocol()
    registerAttachmentProtocol()
    registerIpc()
    ready = true

    if (pending.length > 0) {
      for (const path of pending.splice(0)) await openDocument(path)
    }
    if (!hasOpenDocuments()) showWelcome()
    initAutoUpdater()

    app.on('activate', (_e, hasVisibleWindows) => {
      if (!hasVisibleWindows) showWelcome()
    })
  })

  // Quitting closes every window, and a document window refuses to close until
  // it has settled (last edits saved, unused media swept) — which would cancel
  // the quit. So settle them all first, then quit for real.
  let quitReady = false
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitReady || !hasOpenDocuments()) return
    e.preventDefault()
    if (quitting) return
    quitting = true
    void settleAll().then(() => {
      quitting = false
      quitReady = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
