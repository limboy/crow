import { dialog, net, type BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { basename } from 'path'

function suggestedName(url: string, fallback: string): string {
  try {
    const name = basename(decodeURIComponent(new URL(url).pathname))
    return name && name !== '.' ? name : fallback
  } catch {
    return fallback
  }
}

/**
 * Copies a locally stored media file, or downloads an HTTP(S) media URL, to a
 * path chosen by the user. Remote bodies are passed to fs as an async iterable
 * so large audio files are streamed rather than buffered in memory.
 */
export async function saveMediaAs(
  win: BrowserWindow | null,
  url: string,
  localPath: string | null,
  kind: 'image' | 'audio' | 'video'
): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const remote = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  if (!localPath && !remote) return false

  const options = {
    title: `Save ${kind}`,
    defaultPath: suggestedName(url, kind)
  }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false

  try {
    if (localPath) {
      await fs.copyFile(localPath, result.filePath)
    } else {
      const response = await net.fetch(url)
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with status ${response.status}`)
      }
      await fs.writeFile(result.filePath, response.body)
    }
    return true
  } catch (err) {
    console.error(`[saveMediaAs] failed to save ${kind}`, url, err)
    return false
  }
}
