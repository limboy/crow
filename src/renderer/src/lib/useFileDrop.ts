import { useRef, useState } from 'react'
import { MAX_ATTACHMENT_BYTES, type AttachmentValue } from '@shared/types'
import { attachmentsFrom, formatFileSize } from './fields'
import { importVideoValue } from './videoPoster'

const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

export interface FileDropHandlers {
  isOver: boolean
  /** True from the drop until the file is stored (and, for a video, its cover
   *  captured). The cell only changes once that finishes, so without this the
   *  drop would look like it did nothing for as long as it takes. */
  busy: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

/**
 * Wires up dropping a single OS file (e.g. dragged from Finder/Explorer) onto
 * an element: imports it into local storage and calls `onChange` with the
 * value the cell should hold — the resulting `app-image://`/`app-audio://` URL,
 * or a whole `VideoValue` for a video, whose cover frame is captured on the
 * way in. Returns drag handlers to spread onto the drop target, plus `isOver`
 * and `busy` for hover and in-progress affordances.
 *
 * Reads the file's bytes directly (`File.arrayBuffer()`) rather than going
 * through `webUtils.getPathForFile`, which has proven unreliable for Files
 * crossing the context bridge from a drop event.
 */
export function useFileDrop(
  kind: 'image' | 'audio' | 'video',
  projectId: string,
  onChange: (value: unknown) => void
): FileDropHandlers {
  const [isOver, setIsOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const onDragOver = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsOver(true)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    e.stopPropagation()
    setIsOver(false)
  }

  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const importFile = (data: ArrayBuffer): Promise<unknown> => {
      if (kind === 'video') return importVideoValue(projectId, file.name, data)
      const importData = kind === 'image' ? window.api.importImageData : window.api.importAudioData
      return importData(projectId, file.name, data)
    }
    setBusy(true)
    void file
      .arrayBuffer()
      .then(importFile)
      .then((imported) => {
        if (imported) onChange(imported)
        else console.error(`[useFileDrop] failed to import dropped ${kind} file: ${file.name}`)
      })
      .catch((err) => console.error(`[useFileDrop] error importing dropped ${kind} file`, err))
      .finally(() => setBusy(false))
  }

  return { isOver, busy, onDragOver, onDragLeave, onDrop }
}

export interface AttachmentDropHandlers extends FileDropHandlers {
  /** Adds files to the cell. Exposed so the file picker appends the same way a
   *  drop does, against the same up-to-date list. */
  append: (files: AttachmentValue[]) => void
}

/**
 * Like `useFileDrop`, but for `attachment` cells: drops can carry several OS
 * files at once, each imported independently and appended to the cell rather
 * than replacing its whole value.
 *
 * Owns the appending itself because imports are asynchronous: two drops in
 * quick succession would otherwise both append to the list as it stood when
 * their handler was created, and the second would drop the first's files.
 */
export function useAttachmentDrop(
  projectId: string,
  value: unknown,
  onChange: (files: AttachmentValue[]) => void
): AttachmentDropHandlers {
  const [isOver, setIsOver] = useState(false)
  const [busy, setBusy] = useState(false)

  // Tracks the cell's files across renders *and* across appends that haven't
  // been rendered back yet, so an import landing before React re-renders still
  // sees what the one before it added.
  const filesRef = useRef<AttachmentValue[]>([])
  filesRef.current = attachmentsFrom(value)

  const append = (added: AttachmentValue[]): void => {
    const next = [...filesRef.current, ...added]
    filesRef.current = next
    onChange(next)
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsOver(true)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    e.stopPropagation()
    setIsOver(false)
  }

  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    setIsOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length === 0) return
    // Checked on `File.size` rather than after reading: the point is to never
    // pull an oversized file into memory in the first place.
    const files = dropped.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
    const tooBig = dropped.filter((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (tooBig.length > 0) {
      void window.api.showConfirmDialog({
        alert: true,
        destructive: true,
        title: 'File too large',
        message:
          tooBig.length === 1
            ? `“${tooBig[0].name}” is larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`
            : `${tooBig.length} files are larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`,
        detail: 'Attachments over that size were not added.'
      })
    }
    if (files.length === 0) return
    setBusy(true)
    // Each import settles on its own: one unreadable file in a multi-file drop
    // shouldn't reject the batch and discard the ones that did import.
    void Promise.all(
      files.map((file) =>
        file
          .arrayBuffer()
          .then((data) => window.api.importAttachmentData(projectId, file.name, data))
          .catch((err) => {
            console.error('[useAttachmentDrop] error importing dropped file', file.name, err)
            return null
          })
      )
    )
      .then((results) => {
        const imported = results.filter((r): r is AttachmentValue => r !== null)
        if (imported.length > 0) append(imported)
        if (imported.length < files.length) {
          console.error('[useAttachmentDrop] failed to import one or more dropped files')
        }
      })
      .catch((err) => console.error('[useAttachmentDrop] error handling dropped files', err))
      .finally(() => setBusy(false))
  }

  return { isOver, busy, onDragOver, onDragLeave, onDrop, append }
}
