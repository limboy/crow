import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  existsSync,
  promises as fs,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { newProject } from '@shared/defaults'
import type { Project, RecentDocument } from '@shared/types'
import { BUNDLE_EXT, extractArchive } from './archive'
import {
  DATA_FILE,
  getProject,
  isProjectOpen,
  readProjectAt,
  registerProjectDir,
  remapAssetUrls,
  SAFE_ID,
  sweepUnreferencedMedia,
  unregisterProjectDir,
  wasSavedByUs,
  writeProjectAt
} from './storage'
import { createWindow } from './window'

/**
 * Crow is document-based: every window edits exactly one `.crow` document,
 * which is a directory (see storage.ts). The renderer reads and saves the
 * project inside it directly, so there's nothing to write back — a document
 * is always as current on disk as the renderer's last save.
 */
interface Doc {
  id: string
  /** The `.crow` directory. */
  path: string
  win: BrowserWindow
  watcher?: FSWatcher
  watchTimer?: NodeJS.Timeout
  closing: boolean
  allowClose: boolean
}

const docs = new Map<string, Doc>()
let welcomeWin: BrowserWindow | null = null

const displayName = (path: string): string => basename(path, extname(path))

const isCrowPath = (path: string): boolean => extname(path).toLowerCase() === `.${BUNDLE_EXT}`

function withExt(path: string): string {
  return isCrowPath(path) ? path : `${path}.${BUNDLE_EXT}`
}

function docForPath(path: string): Doc | undefined {
  return [...docs.values()].find((doc) => doc.path === path)
}

function docForWindow(win: BrowserWindow | null | undefined): Doc | undefined {
  return win ? [...docs.values()].find((doc) => doc.win === win) : undefined
}

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.focus()
}

async function showMessage(
  win: BrowserWindow | null,
  type: 'error' | 'info',
  message: string,
  detail: unknown
): Promise<void> {
  const box = { type, message, detail: detail instanceof Error ? detail.message : String(detail) }
  if (win && !win.isDestroyed()) await dialog.showMessageBox(win, box)
  else await dialog.showMessageBox(box)
}

// ---------------------------------------------------------------------------
// Recent documents
// ---------------------------------------------------------------------------

const MAX_RECENT = 10
const recentFile = (): string => join(app.getPath('userData'), 'recent.json')

let onRecentChanged = (): void => {}
/** Registers what to do when the recent list changes (rebuild the menu). */
export function setRecentListener(listener: () => void): void {
  onRecentChanged = listener
}

/** Called whenever the list may have changed: re-watches its folders and tells
 *  the menu and the welcome window. */
function recentChanged(): void {
  watchRecentFolders()
  onRecentChanged()
  if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.webContents.send('documents:recentChanged')
}

function writeRecent(list: string[]): void {
  try {
    writeFileSync(recentFile(), JSON.stringify(list, null, 2), 'utf-8')
  } catch {
    // a lost recent entry isn't worth failing an open over
  }
}

function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(recentFile(), 'utf-8'))
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function addRecent(path: string): void {
  app.addRecentDocument(path)
  writeRecent([path, ...readRecent().filter((p) => p !== path)].slice(0, MAX_RECENT))
  recentChanged()
}

/** Recently opened documents that are still where they were. */
export function getRecentDocuments(): RecentDocument[] {
  return readRecent()
    .filter((path) => existsSync(path))
    .map((path) => ({ path, name: displayName(path), displayPath: tildify(path) }))
}

function tildify(path: string): string {
  const home = app.getPath('home')
  return path === home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path
}

export function clearRecentDocuments(): void {
  app.clearRecentDocuments()
  rmSync(recentFile(), { force: true })
  recentChanged()
}

/** Shows a recent document in Finder (or the platform's file manager). */
function revealRecentDocument(path: string): void {
  if (readRecent().includes(path)) shell.showItemInFolder(path)
}

// Each recent document's folder is watched, so renaming or deleting one in
// Finder updates the list straight away. A rename within the same folder keeps
// the file's inode, which is how the entry follows it to its new name.
const recentWatchers = new Map<string, FSWatcher>()
const recentInodes = new Map<string, number>()
let recentSyncTimer: NodeJS.Timeout | undefined

function inodeOf(path: string): number | undefined {
  try {
    return statSync(path).ino
  } catch {
    return undefined
  }
}

function watchRecentFolders(): void {
  const paths = readRecent()
  recentInodes.clear()
  for (const path of paths) {
    const ino = inodeOf(path)
    if (ino !== undefined) recentInodes.set(path, ino)
  }
  const folders = new Set(paths.map((path) => dirname(path)))
  for (const [folder, watcher] of recentWatchers) {
    if (folders.has(folder)) continue
    watcher.close()
    recentWatchers.delete(folder)
  }
  for (const folder of folders) {
    if (recentWatchers.has(folder)) continue
    try {
      const watcher = watch(folder, () => {
        clearTimeout(recentSyncTimer)
        recentSyncTimer = setTimeout(syncRecent, 200)
      })
      // A folder that's itself deleted errors out; the next sync drops it.
      watcher.on('error', () => {
        watcher.close()
        recentWatchers.delete(folder)
      })
      recentWatchers.set(folder, watcher)
    } catch {
      // the folder is gone or unreadable — nothing to watch
    }
  }
}

/** Finds where a missing recent document was renamed to within its folder. */
function findRenamed(path: string): string | undefined {
  const ino = recentInodes.get(path)
  if (ino === undefined) return undefined
  const folder = dirname(path)
  try {
    for (const name of readdirSync(folder)) {
      const candidate = join(folder, name)
      if (isCrowPath(candidate) && inodeOf(candidate) === ino) return candidate
    }
  } catch {
    // the folder went too
  }
  return undefined
}

function syncRecent(): void {
  const list = readRecent()
  let renamed = false
  const next = list.map((path) => {
    if (existsSync(path)) return path
    const to = findRenamed(path)
    if (!to || list.includes(to)) return path
    renamed = true
    return to
  })
  if (renamed) writeRecent(next)
  recentChanged()
}

// ---------------------------------------------------------------------------
// Flushing the renderer
// ---------------------------------------------------------------------------

let flushSeq = 0
const flushWaiters = new Map<number, () => void>()

/**
 * Asks a document window to push any save it's still debouncing, and waits
 * until it has — otherwise closing a window right after an edit would lose
 * it. Gives up after a few seconds so a hung renderer can't keep a window
 * open forever.
 */
function flushRenderer(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve()
  const token = ++flushSeq
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timeout)
      flushWaiters.delete(token)
      resolve()
    }
    const timeout = setTimeout(done, 3000)
    flushWaiters.set(token, done)
    win.webContents.send('document:flush', token)
  })
}

/** Everything a document needs before its window goes: the last edits
 *  saved, then the media nothing references any more cleared out. */
async function settle(doc: Doc): Promise<void> {
  await flushRenderer(doc.win)
  await sweepUnreferencedMedia(doc.path).catch((err) => {
    console.error('[documents] media sweep failed', err)
  })
}

/** Settles every open document, so the app can quit. */
export async function settleAll(): Promise<void> {
  for (const doc of docs.values()) {
    if (doc.allowClose) continue
    await settle(doc)
    doc.allowClose = true
  }
}

// ---------------------------------------------------------------------------
// Watching for outside changes (e.g. the crow CLI)
// ---------------------------------------------------------------------------

/** Watches the document directory for someone else replacing its data.json;
 *  the window then refetches. Our own saves are recognised by their mtime. */
function watchDocument(doc: Doc): void {
  doc.watcher?.close()
  doc.watcher = undefined
  try {
    doc.watcher = watch(doc.path, (_event, filename) => {
      if (filename && filename !== DATA_FILE) return
      clearTimeout(doc.watchTimer)
      doc.watchTimer = setTimeout(() => void reloadIfChanged(doc), 200)
    })
  } catch (err) {
    console.warn('[documents] could not watch', doc.path, err)
  }
}

async function reloadIfChanged(doc: Doc): Promise<void> {
  let mtime: number
  try {
    mtime = (await fs.stat(join(doc.path, DATA_FILE))).mtimeMs
  } catch {
    return // mid-replace, moved or deleted
  }
  if (wasSavedByUs(doc.id, mtime) || doc.win.isDestroyed()) return
  doc.win.webContents.send('projects:changed')
}

// ---------------------------------------------------------------------------
// Opening, creating, closing
// ---------------------------------------------------------------------------

/**
 * Turns a single-file `.crow` from before documents were packages into one,
 * in place: the package takes the file's name, and the original file is kept
 * beside it as `<name>.crow.zip`. Resolves with the package's path.
 */
async function convertOldFile(path: string): Promise<string> {
  const staging = `${path}.converting-${randomUUID()}`
  try {
    const project = await extractArchive(path, staging)
    await writeProjectAt(staging, project)
    let kept = `${path}.zip`
    for (let n = 2; existsSync(kept); n++) kept = `${path} ${n}.zip`
    await fs.rename(path, kept)
    await fs.rename(staging, path)
    await showMessage(
      welcomeWin,
      'info',
      `“${basename(path)}” was converted to the current document format.`,
      `The original file was kept as “${basename(kept)}”.`
    )
    return path
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true })
    throw err
  }
}

export async function openDocument(input: string): Promise<void> {
  let path = resolve(input)
  // Pointing at the data.json inside a document opens the document.
  if (basename(path) === DATA_FILE && isCrowPath(dirname(path))) path = dirname(path)

  const existing = docForPath(path)
  if (existing) {
    focus(existing.win)
    return
  }

  let project: Project
  try {
    if (!isCrowPath(path)) throw new Error('Only .crow documents can be opened.')
    if ((await fs.stat(path)).isFile()) path = await convertOldFile(path)
    project = await readProjectAt(path)
    // Media urls carry the project id, so two open documents can't share one
    // — a copied document would otherwise be read from its original's folder.
    // The copy gets a fresh id, written back so its urls stay consistent.
    if (!SAFE_ID.test(project.id ?? '') || isProjectOpen(project.id)) {
      project = remapAssetUrls(project, project.id, randomUUID())
      await writeProjectAt(path, project)
    }
  } catch (err) {
    await showMessage(welcomeWin, 'error', `Couldn't open “${basename(path)}”.`, err)
    return
  }

  const id = project.id
  registerProjectDir(id, path)
  const win = createWindow(`/project/${id}`)
  const doc: Doc = { id, path, win, closing: false, allowClose: false }
  docs.set(id, doc)
  applyIdentity(doc)
  watchDocument(doc)
  addRecent(path)

  win.on('close', (e) => {
    if (doc.allowClose) return
    e.preventDefault()
    if (doc.closing) return
    doc.closing = true
    void settle(doc).then(() => {
      doc.allowClose = true
      win.close()
    })
  })

  win.on('closed', () => {
    clearTimeout(doc.watchTimer)
    doc.watcher?.close()
    docs.delete(id)
    unregisterProjectDir(id)
  })

  // The welcome window only exists to get a document open.
  if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close()
}

function applyIdentity(doc: Doc): void {
  if (doc.win.isDestroyed()) return
  doc.win.setTitle(displayName(doc.path))
  if (process.platform === 'darwin') doc.win.setRepresentedFilename(doc.path)
}

/** The project as the renderer sees it: named after its document. */
export async function getDocumentProject(id: string): Promise<Project> {
  const project = await getProject(id)
  const doc = docs.get(id)
  return doc ? { ...project, name: displayName(doc.path) } : project
}

export async function openDocumentDialog(parent?: BrowserWindow | null): Promise<void> {
  const options = {
    title: 'Open',
    // A packaged build registers .crow as a package type, so macOS offers
    // documents as files; openDirectory also lets them be picked where it
    // isn't registered (a dev build), and is the only way elsewhere.
    properties:
      process.platform === 'darwin'
        ? (['openFile', 'openDirectory', 'multiSelections'] as const)
        : (['openDirectory', 'multiSelections'] as const),
    filters: [{ name: 'Crow Document', extensions: [BUNDLE_EXT] }]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
  if (result.canceled) return
  for (const path of result.filePaths) await openDocument(path)
}

/** Asks where to put a document (replacing whatever the user agreed to
 *  replace there), and returns its path — or null if cancelled. */
async function pickNewPath(
  parent: BrowserWindow | null | undefined,
  title: string,
  defaultPath: string,
  buttonLabel?: string
): Promise<string | null> {
  const options = {
    title,
    buttonLabel,
    defaultPath,
    filters: [{ name: 'Crow Document', extensions: [BUNDLE_EXT] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  const path = resolve(withExt(result.filePath))

  const open = docForPath(path)
  if (open) {
    await showMessage(parent ?? null, 'error', `“${basename(path)}” is open.`, 'Close it first to replace it.')
    return null
  }
  // The save panel already asked whether to replace an existing item; only
  // ever a .crow one, since the extension is forced above.
  await fs.rm(path, { recursive: true, force: true })
  return path
}

/** Creates an empty document where the user picks and opens it. Every window
 *  is backed by a real document from the start. */
export async function newDocument(parent?: BrowserWindow | null): Promise<void> {
  const path = await pickNewPath(
    parent,
    'New Document',
    join(app.getPath('documents'), `Untitled.${BUNDLE_EXT}`),
    'Create'
  )
  if (!path) return
  try {
    await fs.mkdir(path, { recursive: true })
    await writeProjectAt(path, newProject(displayName(path)))
  } catch (err) {
    await showMessage(parent ?? null, 'error', `Couldn't create “${basename(path)}”.`, err)
    return
  }
  await openDocument(path)
}

/** Every edit is already on disk; Save just pushes one still in the
 *  renderer's short debounce, for anyone who presses ⌘S out of habit. */
export async function saveDocument(win: BrowserWindow | null | undefined): Promise<void> {
  const doc = docForWindow(win)
  if (doc) await flushRenderer(doc.win)
}

/** Copies the document to a new place and carries on editing the copy. */
export async function saveDocumentAs(win: BrowserWindow | null | undefined): Promise<void> {
  const doc = docForWindow(win)
  if (!doc) return
  const path = await pickNewPath(doc.win, 'Save As', doc.path)
  if (!path || path === doc.path) return

  await flushRenderer(doc.win)
  try {
    await fs.cp(doc.path, path, { recursive: true })
    await writeProjectAt(path, { ...(await readProjectAt(path)), name: displayName(path) })
  } catch (err) {
    await fs.rm(path, { recursive: true, force: true })
    await showMessage(doc.win, 'error', `Couldn't save “${basename(path)}”.`, err)
    return
  }

  doc.path = path
  registerProjectDir(doc.id, path)
  applyIdentity(doc)
  watchDocument(doc)
  addRecent(path)
  // The renderer holds the whole project and saves it whole, so it has to
  // learn the new name or its next save would put the old one back.
  doc.win.webContents.send('document:renamed', displayName(path))
}

/** The window shown when no document is open. */
export function showWelcome(): void {
  if (welcomeWin && !welcomeWin.isDestroyed()) {
    focus(welcomeWin)
    return
  }
  const win = createWindow('/')
  win.setTitle('Crow')
  welcomeWin = win
  win.on('closed', () => {
    if (welcomeWin === win) welcomeWin = null
  })
}

export function hasOpenDocuments(): boolean {
  return docs.size > 0
}

export function registerDocumentIpc(): void {
  ipcMain.on('document:flushed', (_e, token: number) => flushWaiters.get(token)?.())
  ipcMain.handle('documents:new', (e) => newDocument(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('documents:open', (e, path?: string) =>
    path ? openDocument(path) : openDocumentDialog(BrowserWindow.fromWebContents(e.sender))
  )
  ipcMain.handle('documents:recent', () => getRecentDocuments())
  ipcMain.handle('documents:reveal', (_e, path: string) => revealRecentDocument(path))
  watchRecentFolders()
}
