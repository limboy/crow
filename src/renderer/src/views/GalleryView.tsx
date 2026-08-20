import { useState } from 'react'
import { Image as ImageIcon, Plus } from 'lucide-react'
import type { Field, Table, RecordRow, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FieldDialog } from '@/components/FieldDialog'
import { ValueDisplay } from '@/components/ValueDisplay'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { displayValue, isEmptyValue } from '@/lib/fields'
import * as ops from '@/lib/ops'
import type { TableUpdater } from '@/lib/queries'
import { cn } from '@/lib/utils'

type GalleryViewType = Extract<View, { type: 'gallery' }>

export function GalleryView({
  table,
  view,
  update,
  onOpenRecord
}: {
  table: Table
  view: GalleryViewType
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const config = view.config
  const imageFields = table.fields.filter((f) => f.type === 'image')
  const coverField = imageFields.find((f) => f.id === config.coverFieldId)
  const [addFieldOpen, setAddFieldOpen] = useState(false)

  const patchConfig = (patch: Partial<GalleryViewType['config']>): void => {
    update((p) =>
      ops.patchView(p, view.id, (v) =>
        v.type === 'gallery' ? { ...v, config: { ...v.config, ...patch } } : v
      )
    )
  }

  const cardFields = table.fields.filter(
    (f) => !config.hiddenFieldIds.includes(f.id) && f.id !== coverField?.id
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        {imageFields.length > 0 ? (
          <GroupSelect
            fields={imageFields}
            value={config.coverFieldId}
            onChange={(coverFieldId) => patchConfig({ coverFieldId })}
            label="Cover"
            icon={ImageIcon}
            noneLabel="No cover image"
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[13px] font-normal text-muted-foreground"
            onClick={() => setAddFieldOpen(true)}
          >
            <ImageIcon className="size-3.5" />
            Add an image field for covers
          </Button>
        )}
        <FieldsPopover
          fields={table.fields}
          hiddenFieldIds={config.hiddenFieldIds}
          onChange={(hiddenFieldIds) => patchConfig({ hiddenFieldIds })}
          lockedFieldId={table.fields[0]?.id}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {table.records.map((record) => (
            <GalleryCard
              key={record.id}
              record={record}
              coverField={coverField}
              cardFields={cardFields}
              titleField={table.fields[0]}
              onClick={() => onOpenRecord(record.id)}
            />
          ))}
          <button
            className="flex min-h-40 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
            onClick={() => update((p) => ops.addRecord(p))}
          >
            <Plus className="size-4" />
            New record
          </button>
        </div>
      </div>

      <FieldDialog
        open={addFieldOpen}
        onOpenChange={setAddFieldOpen}
        defaultType="image"
        onSubmit={(field) =>
          update((p) => {
            const next = ops.addField(p, field)
            return field.type === 'image'
              ? ops.patchView(next, view.id, (v) =>
                  v.type === 'gallery'
                    ? { ...v, config: { ...v.config, coverFieldId: field.id } }
                    : v
                )
              : next
          })
        }
      />
    </div>
  )
}

function GalleryCard({
  record,
  coverField,
  cardFields,
  titleField,
  onClick
}: {
  record: RecordRow
  coverField?: Field
  cardFields: Field[]
  titleField?: Field
  onClick: () => void
}): React.JSX.Element {
  const coverValue = coverField ? record.values[coverField.id] : undefined
  const hasCover = coverField !== undefined && !isEmptyValue(coverField, coverValue)
  const title = titleField ? displayValue(titleField, record.values[titleField.id]) : ''
  const detailFields = cardFields.filter(
    (f) => f.id !== titleField?.id && !isEmptyValue(f, record.values[f.id])
  )

  return (
    <div
      className="overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      {coverField && (
        <div className="flex h-36 items-center justify-center border-b bg-muted/60">
          {hasCover ? (
            <img src={String(coverValue)} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground/40" />
          )}
        </div>
      )}
      <div className="p-3">
        <div className={cn('truncate text-sm font-medium', !title && 'text-muted-foreground')}>
          {title || 'Untitled'}
        </div>
        {detailFields.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {detailFields.map((field) => (
              <div key={field.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {field.name}
                </span>
                <div className="flex text-xs">
                  <ValueDisplay field={field} value={record.values[field.id]} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
