import { dialog, net, protocol, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import { randomUUID } from 'crypto'
import { projectDir, SAFE_ID } from './storage'
import { saveMediaAs } from './saveMedia'

export const imagesDir = (projectId: string): string => join(projectDir(projectId), 'images')
function imagePath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app-image:') return null
  const [projectId, rawName] = decodeURIComponent(parsed.pathname).split('/').filter(Boolean)
  const name = rawName ? basename(rawName) : ''
  if (!projectId || !SAFE_ID.test(projectId) || !name || name.startsWith('.')) return null
  return join(imagesDir(projectId), name)
}


async function copyIntoImages(projectId: string, source: string): Promise<string> {
  const dir = imagesDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const ext = extname(source).toLowerCase() || '.png'
  const name = `${randomUUID()}${ext}`
  await fs.copyFile(source, join(dir, name))
  return `app-image:///${projectId}/${name}`
}

export async function pickImage(win: BrowserWindow | null, projectId: string): Promise<string | null> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const source = result.filePaths[0]
  if (result.canceled || !source) return null
  return copyIntoImages(projectId, source)
}
export async function saveImageAs(win: BrowserWindow | null, url: string): Promise<boolean> {
  return saveMediaAs(win, url, imagePath(url), 'image')
}


/**
 * Imports raw file bytes (e.g. dropped from the OS file manager). Takes bytes
 * rather than a source path because `webUtils.getPathForFile` has proven
 * unreliable for drag-and-drop Files passed across the context bridge.
 */
export async function importImageData(
  projectId: string,
  name: string,
  data: ArrayBuffer
): Promise<string | null> {
  try {
    const dir = imagesDir(projectId)
    await fs.mkdir(dir, { recursive: true })
    const ext = extname(name).toLowerCase() || '.png'
    const fileName = `${randomUUID()}${ext}`
    // fs.writeFile doesn't accept a raw ArrayBuffer (only Buffer/TypedArray/DataView).
    await fs.writeFile(join(dir, fileName), Buffer.from(data))
    return `app-image:///${projectId}/${fileName}`
  } catch (err) {
    console.error('[importImageData] failed to import', name, err)
    return null
  }
}

// Serves <dataDir>/<projectId>/images/<name> as app-image:///<projectId>/<name>
// so the renderer can display locally stored images without loosening webSecurity.
export function registerImageProtocol(): void {
  protocol.handle('app-image', (request) => {
    const path = imagePath(request.url)
    if (!path) return new Response(null, { status: 400 })
    return net.fetch(pathToFileURL(path).toString())
  })
}
