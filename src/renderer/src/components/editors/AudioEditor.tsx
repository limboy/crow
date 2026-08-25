import { useState } from 'react'
import { Download, FolderOpen, X } from 'lucide-react'
import { AudioPlayer } from '@/components/AudioPlayer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFileDrop } from '@/lib/useFileDrop'
import { cn } from '@/lib/utils'

export function AudioEditor({
  projectId,
  value,
  onChange
}: {
  projectId: string
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const current = typeof value === 'string' && value ? value : undefined
  const [urlDraft, setUrlDraft] = useState('')
  const fileDrop = useFileDrop('audio', projectId, onChange)

  const applyUrl = (): void => {
    const url = urlDraft.trim()
    if (url) {
      onChange(url)
      setUrlDraft('')
    }
  }

  const pickFile = async (): Promise<void> => {
    const url = await window.api.pickAudio(projectId)
    if (url) onChange(url)
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
        <div className="relative flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            className="size-6 shrink-0 shadow-sm"
            title="Save a copy…"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              void window.api.saveAudioAs(current)
            }}
          >
            <Download />
          </Button>
          <AudioPlayer src={current} className="min-w-0 flex-1" />
          <Button
            variant="secondary"
            size="icon"
            className="size-6 shrink-0 shadow-sm"
            title="Remove"
            onClick={() => onChange(undefined)}
          >
            <X />
          </Button>
        </div>
      )}
      <Button variant="outline" size="sm" onClick={() => void pickFile()}>
        <FolderOpen data-slot="icon" />
        Choose file… or drop it here
      </Button>
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-sm"
          placeholder="Or paste an audio URL"
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
