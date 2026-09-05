import { Trash2 } from 'lucide-react'
import type { Table, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ValueEditor } from '@/components/editors/ValueEditor'
import { cellValue, displayValue, fieldTypeInfo } from '@/lib/fields'
import { viewCoverImage } from '@/lib/imageAspect'
import * as ops from '@/lib/ops'
import { useProjectTables } from '@/lib/relations'
import type { TableUpdater } from '@/lib/queries'

export function RecordSheet({
  projectId,
  table,
  view,
  recordId,
  onClose,
  update
}: {
  projectId: string
  table: Table
  /** The view the record was opened from — its cover/thumbnail image field
   *  and aspect ratio (Gallery, Kanban, Calendar) carry over to the panel,
   *  so the image isn't cropped differently here than out in the view. */
  view?: View
  recordId: string | null
  onClose: () => void
  update: TableUpdater
}): React.JSX.Element {
  const tables = useProjectTables()
  const record = table.records.find((r) => r.id === recordId)
  const coverImage = viewCoverImage(view)
  const titleField = table.fields[0]
  // Image/audio/video/attachment fields display as internal file paths (or a
  // raw object/array), which aren't meaningful as a record title.
  const titleIsPath =
    titleField?.type === 'image' ||
    titleField?.type === 'audio' ||
    titleField?.type === 'video' ||
    titleField?.type === 'attachment'
  const title =
    record && titleField && !titleIsPath
      ? displayValue(titleField, cellValue(titleField, record), tables)
      : ''

  return (
    <Sheet open={record !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] gap-0 sm:max-w-[420px]">
        <SheetHeader className="pb-3">
          <SheetTitle className="truncate pr-8">{title || 'Untitled record'}</SheetTitle>
        </SheetHeader>
        {record && (
          <>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
                {table.fields.map((field) => {
                  const info = fieldTypeInfo(field.type)
                  return (
                    <div key={field.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <info.icon className="size-3.5" />
                        {field.name}
                      </div>
                      <ValueEditor
                        projectId={projectId}
                        field={field}
                        value={cellValue(field, record)}
                        onChange={(value) =>
                          update(
                            (p) => ops.setRecordValue(p, record.id, field.id, value),
                            // Text fields here commit on every keystroke, so
                            // undo works on the edit rather than the letter.
                            { coalesceKey: `value:${record.id}:${field.id}` }
                          )
                        }
                        imageAspectRatio={
                          field.id === coverImage.fieldId ? coverImage.aspectRatio : undefined
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
            <Separator />
            <div className="flex items-center justify-between p-4">
              <span className="text-xs text-muted-foreground">
                Created {new Date(record.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  update((p) => ops.deleteRecord(p, record.id))
                  onClose()
                }}
              >
                <Trash2 data-slot="icon" />
                Delete record
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
