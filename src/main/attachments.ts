import { dialog, net, protocol, shell, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import { MAX_ATTACHMENT_BYTES, type AttachmentValue } from '@shared/types'
import { projectDir, SAFE_ID } from './storage'

export const attachmentsDir = (projectId: string): string =>
  join(projectDir(projectId), 'attachments')

// Unlike images/audio, attachments accept any extension (or none), so the
// stored name keeps whatever the source had rather than defaulting one in.
async function copyIntoAttachments(projectId: string, source: string): Promise<AttachmentValue> {
  const dir = attachmentsDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const originalName = basename(source)
  const name = `${randomUUID()}${extname(source)}`
  await fs.copyFile(source, join(dir, name))
  const stat = await fs.stat(join(dir, name))
  return { url: `app-attachment:///${projectId}/${name}`, name: originalName, size: stat.size }
}

/**
 * Resolves an `app-attachment:///<projectId>/<name>` url to the file it stands
 * for, or null if it isn't one this app stores. Every path that touches the
 * disk on a url's say-so goes through here, so a hand-edited project file can't
 * aim the opener (or the protocol handler) at something outside the store.
 */
function attachmentPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app-attachment:') return null
  const [projectId, rawName] = decodeURIComponent(parsed.pathname).split('/').filter(Boolean)
  const name = rawName ? basename(rawName) : ''
  if (!projectId || !SAFE_ID.test(projectId) || !name || name.startsWith('.')) return null
  return join(attachmentsDir(projectId), name)
}

export async function pickAttachments(
  win: BrowserWindow | null,
  projectId: string
): Promise<AttachmentValue[] | null> {
  const options = { properties: ['openFile' as const, 'multiSelections' as const] }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  const files: AttachmentValue[] = []
  for (const source of result.filePaths) {
    files.push(await copyIntoAttachments(projectId, source))
  }
  return files
}

/**
 * Imports raw file bytes (e.g. dropped from the OS file manager). Takes bytes
 * rather than a source path because `webUtils.getPathForFile` has proven
 * unreliable for drag-and-drop Files passed across the context bridge.
 */
export async function importAttachmentData(
  projectId: string,
  name: string,
  data: ArrayBuffer
): Promise<AttachmentValue | null> {
  try {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      console.error('[importAttachmentData] refusing oversized file', name, data.byteLength)
      return null
    }
    const dir = attachmentsDir(projectId)
    await fs.mkdir(dir, { recursive: true })
    const fileName = `${randomUUID()}${extname(name)}`
    // fs.writeFile doesn't accept a raw ArrayBuffer (only Buffer/TypedArray/DataView).
    const buffer = Buffer.from(data)
    await fs.writeFile(join(dir, fileName), buffer)
    return { url: `app-attachment:///${projectId}/${fileName}`, name, size: buffer.byteLength }
  } catch (err) {
    console.error('[importAttachmentData] failed to import', name, err)
    return null
  }
}

/** Hands the file to whatever the OS opens that type with. Deliberately not a
 *  link in the renderer: navigating the window to an attachment would run the
 *  preload — and so expose `window.api` — against file contents that can have
 *  arrived inside an imported project. */
export async function openAttachment(url: string): Promise<boolean> {
  const path = attachmentPath(url)
  if (!path) return false
  const error = await shell.openPath(path)
  if (error) {
    console.error('[openAttachment] failed to open', url, error)
    return false
  }
  return true
}

/** Copies the stored file back out to wherever the user picks. */
export async function saveAttachmentAs(
  win: BrowserWindow | null,
  url: string,
  suggestedName: string
): Promise<boolean> {
  const path = attachmentPath(url)
  if (!path) return false
  const options = { title: 'Save attachment', defaultPath: basename(suggestedName) }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false
  try {
    await fs.copyFile(path, result.filePath)
    return true
  } catch (err) {
    console.error('[saveAttachmentAs] failed to save', url, err)
    return false
  }
}

// Serves <dataDir>/<projectId>/attachments/<name> as app-attachment:///<projectId>/<name>
// so the renderer can reference locally stored files without loosening webSecurity.
export function registerAttachmentProtocol(): void {
  protocol.handle('app-attachment', (request) => {
    const path = attachmentPath(request.url)
    if (!path) return new Response(null, { status: 400 })
    return net.fetch(pathToFileURL(path).toString())
  })
}
