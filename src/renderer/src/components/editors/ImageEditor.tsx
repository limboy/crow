import { useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFileDrop } from '@/lib/useFileDrop'
import { cn } from '@/lib/utils'

export function ImageEditor({
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
            className="block w-full cursor-zoom-in"
            onClick={() => setPreviewOpen(true)}
          >
            <img
              src={current}
              alt=""
              className="max-h-40 w-full rounded-md border object-cover"
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
