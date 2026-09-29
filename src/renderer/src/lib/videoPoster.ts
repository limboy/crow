/**
 * Cover frames for `video` cells.
 *
 * The app never plays a video inline — that's the OS player's job — so a cell
 * shows a still instead. The still is grabbed here, in the renderer, by
 * decoding the video off-screen: no bundled ffmpeg, and the frame comes out of
 * the same decoder that would render it. It's then stored as an ordinary image
 * asset, which is what lets a video field be featured as a card cover
 * alongside real image fields.
 */

import { useEffect } from 'react'
import type { Project, VideoValue } from '@shared/types'
import { videoFrom } from '@/lib/fields'

/** How far into the video the cover frame is taken from. A quarter in is past
 *  the title card or fade-in that makes the opening frames useless as a
 *  thumbnail, and still early enough to seek to quickly. */
const POSTER_POSITION = 0.25

/** Cap on the stored frame's width. A cover is displayed a few hundred pixels
 *  wide at most, so keeping 4K frames at full size would cost megabytes per
 *  record for detail nothing ever shows. */
const MAX_POSTER_WIDTH = 1280

const POSTER_QUALITY = 0.85

/** Long enough for a slow decoder on a large file, short enough that a video
 *  the decoder can't handle at all doesn't hang the import. */
const CAPTURE_TIMEOUT_MS = 20_000

function once<T extends Event>(target: EventTarget, event: string): Promise<T> {
  return new Promise((resolve) => target.addEventListener(event, resolve as EventListener, { once: true }))
}

/** Decodes the video far enough to grab its cover frame. Null when it can't
 *  be decoded, has no known duration (a live stream), or is a remote file the
 *  server won't share with a canvas. */
async function captureFrame(url: string): Promise<Blob | null> {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  // A canvas drawn from a foreign origin can't be exported, and an
  // `app-video:` url is one as far as the renderer's document is concerned.
  // The app's own handler answers with the CORS header this asks for; a remote
  // server may not, in which case the load simply fails and there's no cover.
  video.crossOrigin = 'anonymous'
  video.src = url

  try {
    await Promise.race([
      Promise.race([once(video, 'loadedmetadata'), once(video, 'error').then(() => null)]),
      new Promise((resolve) => setTimeout(resolve, CAPTURE_TIMEOUT_MS))
    ])
    const { duration, videoWidth, videoHeight } = video
    if (!Number.isFinite(duration) || duration <= 0 || !videoWidth || !videoHeight) return null

    video.currentTime = duration * POSTER_POSITION
    // `seeked` is the signal to draw on. The obvious alternative,
    // `requestVideoFrameCallback`, never fires here: this element is never in
    // the document, so nothing ever composites a frame for it.
    await Promise.race([
      once(video, 'seeked'),
      new Promise((resolve) => setTimeout(resolve, CAPTURE_TIMEOUT_MS))
    ])
    if (video.readyState < video.HAVE_CURRENT_DATA) return null

    const scale = Math.min(1, MAX_POSTER_WIDTH / videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(videoWidth * scale)
    canvas.height = Math.round(videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => {
      // A tainted canvas rejects by handing the callback null rather than throwing.
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', POSTER_QUALITY)
    })
  } finally {
    // Stops the decoder and lets go of the buffered bytes; without this the
    // element keeps downloading a file nobody is watching.
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * Captures a video's cover frame and stores it as an image in the project,
 * returning its `app-image://` url. Undefined when the frame couldn't be
 * captured — the cell still holds the video, it just shows a placeholder.
 */
export async function captureVideoPoster(
  projectId: string,
  url: string
): Promise<string | undefined> {
  try {
    const blob = await captureFrame(url)
    if (!blob) return undefined
    // The name only supplies the stored file's extension; the file itself is
    // saved under a generated id like any other image.
    const poster = await window.api.importImageData(projectId, 'poster.jpg', await blob.arrayBuffer())
    return poster ?? undefined
  } catch (err) {
    console.error('[captureVideoPoster] failed to capture a cover frame for', url, err)
    return undefined
  }
}

/**
 * Stores a video's bytes in the project and captures its cover, giving back
 * the value a `video` cell holds. Null when the bytes couldn't be stored; a
 * cover that can't be captured only leaves `poster` unset.
 */
export async function importVideoValue(
  projectId: string,
  name: string,
  data: ArrayBuffer
): Promise<VideoValue | null> {
  const url = await window.api.importVideoData(projectId, name, data)
  if (!url) return null
  return { url, name, poster: await captureVideoPoster(projectId, url) }
}

/** Stored videos in the project that have no cover yet — what the CLI adds,
 *  since it has no decoder to capture one with. External urls are left to
 *  the editor, which captures as the url is entered. */
function videosWithoutPoster(project: Project): Set<string> {
  const urls = new Set<string>()
  for (const table of project.tables) {
    const videoFields = table.fields.filter((f) => f.type === 'video')
    if (videoFields.length === 0) continue
    for (const record of table.records) {
      for (const field of videoFields) {
        const video = videoFrom(record.values[field.id])
        if (video && !video.poster && video.url.startsWith('app-video:')) urls.add(video.url)
      }
    }
  }
  return urls
}

/** Gives every cell holding one of these videos its cover. Returns the same
 *  project when none of them needed it, so nothing gets saved. */
function withPosters(project: Project, posters: Map<string, string>): Project {
  let changed = false
  const tables = project.tables.map((table) => {
    const videoFields = table.fields.filter((f) => f.type === 'video')
    if (videoFields.length === 0) return table
    let tableChanged = false
    const records = table.records.map((record) => {
      let values = record.values
      for (const field of videoFields) {
        const video = videoFrom(values[field.id])
        const poster = video && !video.poster ? posters.get(video.url) : undefined
        if (!video || !poster) continue
        values = { ...values, [field.id]: { ...video, poster } }
      }
      if (values === record.values) return record
      tableChanged = true
      return { ...record, values }
    })
    if (!tableChanged) return table
    changed = true
    return { ...table, records }
  })
  return changed ? { ...project, tables } : project
}

/** Every capture this session, keyed by project and video url: the poster's
 *  url, or null when the video couldn't be decoded — so it isn't retried on
 *  every change, and a cover lost to undo comes back without decoding again. */
const captured = new Map<string, string | null>()
/** One capture at a time: a CLI import of a dozen videos shouldn't have a
 *  dozen decoders seeking at once. */
let queue: Promise<void> = Promise.resolve()

/**
 * Captures the cover of any stored video that arrived without one — added by
 * the CLI, or by an older version of the app — whenever the project changes.
 * `amend` applies it without an undo step; see useAmendProject.
 */
export function useVideoPosterBackfill(
  projectId: string,
  project: Project | undefined,
  amend: (updater: (project: Project) => Project) => void
): void {
  useEffect(() => {
    if (!project) return
    const known = new Map<string, string>()
    for (const url of videosWithoutPoster(project)) {
      const key = `${projectId}\n${url}`
      if (captured.has(key)) {
        const poster = captured.get(key)
        if (poster) known.set(url, poster)
        continue
      }
      captured.set(key, null) // claimed; also what a failure leaves behind
      queue = queue.then(async () => {
        const poster = await captureVideoPoster(projectId, url)
        if (!poster) return
        captured.set(key, poster)
        amend((latest) => withPosters(latest, new Map([[url, poster]])))
      })
    }
    if (known.size > 0) amend((latest) => withPosters(latest, known))
  }, [projectId, project, amend])
}
