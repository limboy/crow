import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import { settleAll } from './documents'

// How often to poll GitHub for a newer release while the app stays open.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours
// Give the window a moment to open before the first network check.
const INITIAL_CHECK_DELAY_MS = 10_000

// Version of an update that has finished downloading and is ready to install.
// Non-null is what the renderer uses to decide whether to show the update button.
let readyVersion: string | null = null

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

export function getReadyUpdateVersion(): string | null {
  return readyVersion
}

export async function installReadyUpdate(): Promise<void> {
  if (!readyVersion) return
  // Open documents are settled first: the install closes every window, and a
  // document window that hasn't settled would refuse to go.
  await settleAll()
  // Installs the downloaded update and relaunches the app.
  autoUpdater.quitAndInstall()
}

function message(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = BrowserWindow.getFocusedWindow()
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

async function offerInstall(version: string): Promise<void> {
  const { response } = await message({
    type: 'info',
    message: `Crow ${version} is ready to install`,
    detail: 'Restart Crow now to finish updating?',
    buttons: ['Restart and Install', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) await installReadyUpdate()
}

/**
 * "Check for Updates…" in the app menu. Unlike the background check, it
 * reports every outcome, and once a new version has downloaded it offers to
 * install it right away (the title-bar Update button stays as the other way in).
 */
export async function checkForUpdatesManually(): Promise<void> {
  if (!app.isPackaged) {
    await message({ type: 'info', message: 'Updates are only available in the packaged app.' })
    return
  }
  if (readyVersion) return offerInstall(readyVersion)

  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      await message({
        type: 'info',
        message: 'You’re up to date',
        detail: `Crow ${app.getVersion()} is the latest version.`
      })
      return
    }
    const version = result.updateInfo.version
    void message({
      type: 'info',
      message: `Crow ${version} is available`,
      detail: 'It’s downloading now. You’ll be asked to restart when it’s ready.'
    })
    await result.downloadPromise
    // No download promise when a background check had already started one:
    // wait for that one to land instead.
    if (!readyVersion) {
      await new Promise<void>((resolve) => autoUpdater.once('update-downloaded', () => resolve()))
    }
    await offerInstall(readyVersion ?? version)
  } catch (err) {
    await message({
      type: 'warning',
      message: 'Couldn’t check for updates',
      detail: err instanceof Error ? err.message : String(err)
    })
  }
}

export function initAutoUpdater(): void {
  // electron-updater reads app-update.yml / the GitHub release feed that only
  // exists in a packaged, signed build — there's nothing to check in dev.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // Install is user-initiated (update button click), not forced on quit.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    readyVersion = info.version
    broadcast('updater:ready', info.version)
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err)
  })

  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err)
    })
  }

  setTimeout(check, INITIAL_CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS)
}
