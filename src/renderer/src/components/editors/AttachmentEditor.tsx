import { Download, File as FileIcon, FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { attachmentsFrom, formatFileSize } from '@/lib/fields'
import { useAttachmentDrop } from '@/lib/useFileDrop'
import { cn } from '@/lib/utils'

export function AttachmentEditor({
  projectId,
  value,
  onChange
}: {
  projectId: string
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const files = attachmentsFrom(value)
  const fileDrop = useAttachmentDrop(projectId, value, onChange)

  const pickFiles = async (): Promise<void> => {
    const picked = await window.api.pickAttachments(projectId)
    if (picked && picked.length > 0) fileDrop.append(picked)
  }

  const removeAt = (index: number): void => {
    const next = files.filter((_, i) => i !== index)
    onChange(next.length > 0 ? next : undefined)
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
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, i) => (
            <li
              key={`${file.url}-${i}`}
              className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <FileIcon data-slot="icon" className="shrink-0 text-muted-foreground" />
              <button
                type="button"
                // Opened through the main process rather than linked to: a
                // navigation to an `app-attachment:` url would run the preload
                // against the file's own contents.
                onClick={(e) => {
                  e.stopPropagation()
                  void window.api.openAttachment(file.url)
                }}
                title={file.name}
                className="min-w-0 flex-1 truncate text-left hover:underline"
              >
                {file.name}
              </button>
              {typeof file.size === 'number' && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                title="Save a copy…"
                onClick={() => void window.api.saveAttachmentAs(file.url, file.name)}
              >
                <Download />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                title="Remove"
                onClick={() => removeAt(i)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" size="sm" onClick={() => void pickFiles()}>
        <FolderOpen data-slot="icon" />
        Choose files… or drop them here
      </Button>
    </div>
  )
}
