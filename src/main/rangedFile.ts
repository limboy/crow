import { net } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { extname } from 'path'
import { pathToFileURL } from 'url'

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

/**
 * Answers a request for a local file, honouring `Range`. `net.fetch` on a
 * file:// url ignores the header and always replies 200 with the whole file,
 * so a media element resuming mid-file would be handed bytes from the start.
 */
export async function serveRangedFile(
  request: Request,
  path: string,
  contentTypes: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  let size: number
  try {
    size = (await fs.stat(path)).size
  } catch {
    return net.fetch(pathToFileURL(path).toString()) // let it produce the 404
  }
  const type = contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const range = parseRange(request.headers.get('range'), size)
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      status: 200,
      headers: {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': String(size),
        ...extraHeaders
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
      ...extraHeaders
    }
  })
}
