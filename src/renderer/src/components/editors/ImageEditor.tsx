import { useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import type { ImageAspectRatio } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { imageAspectRatioInfo } from '@/lib/imageAspect'
import { useFileDrop } from '@/lib/useFileDrop'
import { cn } from '@/lib/utils'

export function ImageEditor({
  projectId,
  value,
  onChange,
  aspectRatio
}: {
  projectId: string
  value: unknown
  onChange: (value: unknown) => void
  /** Crops the preview to the ratio a view features this field's images at
   *  (e.g. Gallery's cover image), so the detail panel matches what the
   *  record looks like out in that view. Left free-form when unset. */
  aspectRatio?: ImageAspectRatio
}): React.JSX.Element {
  const current = typeof value === 'string' && value ? value : undefined
  const [urlDraft, setUrlDraft] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const fileDrop = useFileDrop('image', projectId, onChange)

  const applyUrl = (): void => {
    const url = urlDraft.trim()
    if (url) {
      onChange(url)
      setUrlDraft('')
    }
  }

  const pickFile = async (): Promise<void> => {
    const url = await window.api.pickImage(projectId)
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
        <div className="relative">
          <button
            type="button"
            className={cn(
              'block w-full cursor-zoom-in overflow-hidden rounded-md border',
              aspectRatio && imageAspectRatioInfo(aspectRatio).className
            )}
            onClick={() => setPreviewOpen(true)}
          >
            <img
              src={current}
              alt=""
              className={cn('w-full object-cover', aspectRatio ? 'h-full' : 'max-h-40')}
            />
          </button>
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-1.5 top-1.5 size-6 shadow-sm"
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
          placeholder="Or paste an image URL"
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
      {current && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent
            showCloseButton={false}
            className="flex w-auto max-w-[calc(100%-2rem)] items-center justify-center border-none bg-transparent p-0 shadow-none ring-0 sm:max-w-[calc(100%-4rem)]"
          >
            <DialogTitle className="sr-only">Image preview</DialogTitle>
            <img
              src={current}
              alt=""
              className="max-h-[85vh] max-w-full cursor-zoom-out rounded-md object-contain"
              onClick={() => setPreviewOpen(false)}
            />
            <DialogClose
              render={
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute top-2 right-2 rounded-full bg-black/60 text-white shadow-md hover:bg-black/80 hover:text-white"
                />
              }
            >
              <X />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
