import { dialog, net, protocol, shell, type BrowserWindow } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import type { VideoValue } from '@shared/types'
import { projectDir, SAFE_ID } from './storage'
import { saveMediaAs } from './saveMedia'

export const videoDir = (projectId: string): string => join(projectDir(projectId), 'video')
function videoPath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app-video:') return null
  const [projectId, rawName] = decodeURIComponent(parsed.pathname).split('/').filter(Boolean)
  const name = rawName ? basename(rawName) : ''
  if (!projectId || !SAFE_ID.test(projectId) || !name || name.startsWith('.')) return null
  return join(videoDir(projectId), name)
}

// The stored file is named with a generated id, like every other asset, so
// the original name comes back alongside the url for the cell to keep — the
// renderer has no other way to learn it from a picked file.
async function copyIntoVideo(projectId: string, source: string): Promise<VideoValue> {
  const dir = videoDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const ext = extname(source).toLowerCase() || '.mp4'
  const name = `${randomUUID()}${ext}`
  await fs.copyFile(source, join(dir, name))
  return { url: `app-video:///${projectId}/${name}`, name: basename(source) }
}

export async function pickVideo(
  win: BrowserWindow | null,
  projectId: string
): Promise<VideoValue | null> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'webm', 'ogv', 'mkv', 'avi'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const source = result.filePaths[0]
  if (result.canceled || !source) return null
  return copyIntoVideo(projectId, source)
}
export async function saveVideoAs(win: BrowserWindow | null, url: string): Promise<boolean> {
  return saveMediaAs(win, url, videoPath(url), 'video')
}

/**
 * Imports raw file bytes (e.g. dropped from the OS file manager). Takes bytes
 * rather than a source path because `webUtils.getPathForFile` has proven
 * unreliable for drag-and-drop Files passed across the context bridge.
 */
export async function importVideoData(
  projectId: string,
  name: string,
  data: ArrayBuffer
): Promise<string | null> {
  try {
    const dir = videoDir(projectId)
    await fs.mkdir(dir, { recursive: true })
    const ext = extname(name).toLowerCase() || '.mp4'
    const fileName = `${randomUUID()}${ext}`
    // fs.writeFile doesn't accept a raw ArrayBuffer (only Buffer/TypedArray/DataView).
    await fs.writeFile(join(dir, fileName), Buffer.from(data))
    return `app-video:///${projectId}/${fileName}`
  } catch (err) {
    console.error('[importVideoData] failed to import', name, err)
    return null
  }
}

/** Hands the video to whatever the OS plays that type with. Deliberately not
 *  a link or an inline player in the renderer: navigating the window to an
 *  `app-video:` url would run the preload — and so expose `window.api` —
 *  against file contents that can have arrived inside an imported project. */
export async function openVideo(url: string): Promise<boolean> {
  const path = videoPath(url)
  if (!path) {
    // A video field may also hold an external url; that one belongs to the
    // browser, which is where every other outbound link in the app goes.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    await shell.openExternal(url)
    return true
  }
  const error = await shell.openPath(path)
  if (error) {
    console.error('[openVideo] failed to open', url, error)
    return false
  }
  return true
}

/** Content types for the extensions the picker offers. Chromium decides
 *  whether it can play a video from this header, so a missing or wrong one
 *  fails the load outright rather than falling back to sniffing. */
const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}

/** `bytes=<start>-<end>`, the only form Chromium's media pipeline sends. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header && /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  // A suffix range (`bytes=-500`) asks for the last N bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(start) || start > end || start >= size) return null
  return { start, end }
}

// Serves <dataDir>/<projectId>/video/<name> as app-video:///<projectId>/<name>.
// Unlike images and audio this answers range requests itself rather than
// deferring to net.fetch: a poster is captured a quarter of the way into the
// file, and without ranges the renderer would have to pull everything before
// that point through memory just to seek there.
export function registerVideoProtocol(): void {
  protocol.handle('app-video', async (request) => {
    const path = videoPath(request.url)
    if (!path) return new Response(null, { status: 400 })
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch {
      return net.fetch(pathToFileURL(path).toString()) // let it produce the 404
    }
    const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = parseRange(request.headers.get('range'), size)
    if (!range) {
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
        status: 200,
        headers: {
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-length': String(size),
          // Lets the renderer read the frames back out of a canvas; see the
          // scheme's `corsEnabled` privilege in index.ts.
          'access-control-allow-origin': '*'
        }
      })
    }
    const stream = createReadStream(path, { start: range.start, end: range.end })
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'access-control-allow-origin': '*'
      }
    })
  })
}
