import { useState } from 'react'
import { Download, FolderOpen, Loader2, Play, RefreshCw, X } from 'lucide-react'
import type { ImageAspectRatio, VideoValue } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { videoFrom, videoLabel } from '@/lib/fields'
import { imageAspectRatioInfo } from '@/lib/imageAspect'
import { useFileDrop } from '@/lib/useFileDrop'
import { captureVideoPoster } from '@/lib/videoPoster'
import { cn } from '@/lib/utils'

export function VideoEditor({
  projectId,
  value,
  onChange,
  aspectRatio
}: {
  projectId: string
  value: unknown
  onChange: (value: unknown) => void
  /** Crops the poster to the ratio a view features this field at, the way
   *  `ImageEditor` does — a video field can be a card's cover image. */
  aspectRatio?: ImageAspectRatio
}): React.JSX.Element {
  const current = videoFrom(value)
  const [urlDraft, setUrlDraft] = useState('')
  const [capturing, setCapturing] = useState(false)
  const fileDrop = useFileDrop('video', projectId, onChange)
  const busy = fileDrop.busy || capturing

  /** Grabs the cover frame for a video that arrived without one — a url typed
   *  in here, or a file added by the CLI, which has no decoder to capture with. */
  const captureCover = async (video: VideoValue): Promise<void> => {
    setCapturing(true)
    try {
      const poster = await captureVideoPoster(projectId, video.url)
      if (poster) onChange({ ...video, poster })
    } finally {
      setCapturing(false)
    }
  }

  const applyUrl = (): void => {
    const url = urlDraft.trim()
    if (!url) return
    const video: VideoValue = { url }
    onChange(video)
    setUrlDraft('')
    void captureCover(video)
  }

  const pickFile = async (): Promise<void> => {
    const picked = await window.api.pickVideo(projectId)
    if (!picked) return
    onChange(picked)
    void captureCover(picked)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md',
        fileDrop.isOver && 'bg-accent/60 ring-2 ring-primary'
      )}
      onDragOver={fileDrop.onDragOver}
      onDragLeave={fileDrop.onDragLeave}
      onDrop={fileDrop.onDrop}
    >
      {current && (
        <div className="relative">
          <button
            type="button"
            title={`Play ${videoLabel(current)}`}
            className={cn(
              'flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-muted/60',
              aspectRatio ? imageAspectRatioInfo(aspectRatio).className : 'max-h-40'
            )}
            // Handed to the OS player rather than played here: navigating this
            // window to an `app-video:` url would run the preload against the
            // file's own contents.
            onClick={() => void window.api.openVideo(current.url)}
          >
            {current.poster ? (
              <img
                src={current.poster}
                alt=""
                className={cn('w-full object-cover', aspectRatio ? 'h-full' : 'max-h-40')}
              />
            ) : (
              <span className="flex h-24 items-center px-3 text-xs text-muted-foreground">
                {capturing ? 'Capturing cover…' : videoLabel(current)}
              </span>
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
                <Play className="size-4 fill-current" />
              </span>
            </span>
          </button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-1.5 top-1.5 size-6 shadow-sm"
            title="Save a copy…"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              void window.api.saveVideoAs(current.url)
            }}
          >
            <Download />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-1.5 top-1.5 size-6 shadow-sm"
            title="Remove"
            onClick={() => onChange(undefined)}
          >
            <X />
          </Button>
        </div>
      )}
      {current && (
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {videoLabel(current)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs text-muted-foreground"
            disabled={capturing}
            title="Capture the cover frame again"
            onClick={() => void captureCover(current)}
          >
            {capturing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {current.poster ? 'Recapture cover' : 'Capture cover'}
          </Button>
        </div>
      )}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void pickFile()}>
        {fileDrop.busy ? <Loader2 data-slot="icon" className="animate-spin" /> : <FolderOpen data-slot="icon" />}
        {fileDrop.busy ? 'Adding video…' : 'Choose file… or drop it here'}
      </Button>
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-sm"
          placeholder="Or paste a video URL"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyUrl()}
        />
        {urlDraft.trim() && (
          <Button size="sm" variant="secondary" onClick={applyUrl}>
            Set
          </Button>
        )}
      </div>
    </div>
  )
}
