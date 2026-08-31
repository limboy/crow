import { useState } from 'react'
import { Image as ImageIcon, Plus } from 'lucide-react'
import type { Field, ImageAspectRatio, Table, RecordRow, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import { FieldDialog } from '@/components/FieldDialog'
import { ValueDisplay } from '@/components/ValueDisplay'
import {
  getFindCellState,
  useViewFind,
  ViewFindControl,
  type ViewFindController
} from '@/components/ViewFind'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { ImageFieldSelect } from '@/components/toolbar/ImageFieldSelect'
import { SortPopover } from '@/components/toolbar/SortPopover'
import { applyFilters, applySorts } from '@/lib/derive'
import { cellValue, displayValue, isEmptyValue } from '@/lib/fields'
import { imageAspectRatioInfo } from '@/lib/imageAspect'
import { useProjectTables } from '@/lib/relations'
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
  // Sorting by a relation field compares the labels of the linked records,
  // which live in a sibling table.
  const tables = useProjectTables()
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

  const derived = applySorts(
    applyFilters(table.records, config.filters, table.fields, config.filterMatch),
    config.sorts,
    table.fields,
    tables
  )
  const find = useViewFind(derived, cardFields, tables)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        {imageFields.length > 0 ? (
          <ImageFieldSelect
            fields={imageFields}
            value={config.coverFieldId}
            aspectRatio={config.imageAspectRatio}
            onFieldChange={(coverFieldId) => patchConfig({ coverFieldId })}
            onAspectRatioChange={(imageAspectRatio) => patchConfig({ imageAspectRatio })}
            label="Cover"
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
        <FilterPopover
          fields={table.fields}
          filters={config.filters}
          match={config.filterMatch}
          onMatchChange={(filterMatch) => patchConfig({ filterMatch })}
          onChange={(filters) => patchConfig({ filters })}
        />
        <SortPopover
          fields={table.fields}
          sorts={config.sorts}
          onChange={(sorts) => patchConfig({ sorts })}
        />
        <ViewFindControl find={find} className="ml-auto" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {derived.map((record) => (
            <GalleryCard
              key={record.id}
              record={record}
              coverField={coverField}
              aspectRatio={config.imageAspectRatio}
              cardFields={cardFields}
              titleField={table.fields[0]}
              find={find}
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
  aspectRatio,
  cardFields,
  titleField,
  find,
  onClick
}: {
  record: RecordRow
  coverField?: Field
  aspectRatio?: ImageAspectRatio
  cardFields: Field[]
  titleField?: Field
  find: ViewFindController
  onClick: () => void
}): React.JSX.Element {
  const coverValue = coverField ? record.values[coverField.id] : undefined
  const hasCover = coverField !== undefined && !isEmptyValue(coverField, coverValue)
  const tables = useProjectTables()
  // If the title field is the same field used as the cover image, showing its
  // raw value (e.g. an app-image:// URL) as text would be redundant with the
  // image itself, so treat it as if there's no title to show.
  const showTitle = titleField !== undefined && titleField.id !== coverField?.id
  const title = showTitle ? displayValue(titleField, cellValue(titleField, record), tables) : ''
  const detailFields = cardFields.filter(
    (f) => f.id !== titleField?.id && !isEmptyValue(f, cellValue(f, record))
  )
  const hasContent = showTitle || detailFields.length > 0
  const findStates = [...(showTitle && titleField ? [titleField] : []), ...detailFields].map(
    (field) => getFindCellState(find, record.id, field.id)
  )
  const cardFindState = {
    matched: findStates.some((state) => state.matched),
    active: findStates.some((state) => state.active)
  }

  return (
    <div
      data-find-active={cardFindState.active ? 'true' : undefined}
      className={cn(
        'overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md',
        cardFindState.matched && 'ring-4 ring-find-match',
        cardFindState.active && 'ring-find-highlight'
      )}
      onClick={onClick}
    >
      {coverField && (
        <div
          className={cn(
            'flex items-center justify-center border-b bg-muted/60',
            imageAspectRatioInfo(aspectRatio).className
          )}
        >
          {hasCover ? (
            <img src={String(coverValue)} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground/40" />
          )}
        </div>
      )}
      {hasContent && (
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
                    <ValueDisplay field={field} value={cellValue(field, record)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
