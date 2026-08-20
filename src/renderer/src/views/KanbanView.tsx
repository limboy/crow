import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { CircleChevronDown, Plus, SquareKanban } from 'lucide-react'
import type { Field, Table, RecordRow, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { ChoiceBadge } from '@/components/ChoiceBadge'
import { ValueDisplay } from '@/components/ValueDisplay'
import { FieldDialog } from '@/components/FieldDialog'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { groupRecords, UNCATEGORIZED, type RecordGroup } from '@/lib/derive'
import { displayValue, isEmptyValue } from '@/lib/fields'
import * as ops from '@/lib/ops'
import { useProjectTables } from '@/lib/relations'
import type { TableUpdater } from '@/lib/queries'
import { cn } from '@/lib/utils'

type KanbanViewType = Extract<View, { type: 'kanban' }>

export function KanbanView({
  table,
  view,
  update,
  onOpenRecord
}: {
  table: Table
  view: KanbanViewType
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const config = view.config
  const selectFields = table.fields.filter((f) => f.type === 'select')
  const groupField = selectFields.find((f) => f.id === config.groupByFieldId)
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null)
  const [addFieldOpen, setAddFieldOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  const patchConfig = (patch: Partial<KanbanViewType['config']>): void => {
    update((p) =>
      ops.patchView(p, view.id, (v) =>
        v.type === 'kanban' ? { ...v, config: { ...v.config, ...patch } } : v
      )
    )
  }

  const cardFields = table.fields.filter(
    (f) => !config.hiddenFieldIds.includes(f.id) && f.id !== groupField?.id
  )

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveRecordId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveRecordId(null)
    if (!groupField || !event.over) return
    const columnKey = String(event.over.id)
    const recordId = String(event.active.id)
    const value = columnKey === UNCATEGORIZED ? undefined : columnKey
    update((p) => ops.setRecordValue(p, recordId, groupField.id, value))
  }

  if (!groupField) {
    return (
      <div className="flex h-full flex-col">
        <Toolbar
          table={table}
          config={config}
          selectFields={selectFields}
          patchConfig={patchConfig}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <SquareKanban className="size-8 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">Choose a field to group by</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Kanban stacks records into columns using a single-select field.
            </p>
          </div>
          {selectFields.length > 0 ? (
            <GroupSelect
              fields={selectFields}
              value={undefined}
              onChange={(fieldId) => patchConfig({ groupByFieldId: fieldId })}
              label="Group"
              noneLabel="No grouping"
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAddFieldOpen(true)}>
              <CircleChevronDown data-slot="icon" />
              Add a single-select field
            </Button>
          )}
        </div>
        <FieldDialog
          open={addFieldOpen}
          onOpenChange={setAddFieldOpen}
          defaultType="select"
          onSubmit={(field) =>
            update((p) => {
              const next = ops.addField(p, field)
              return field.type === 'select'
                ? ops.patchView(next, view.id, (v) =>
                    v.type === 'kanban'
                      ? { ...v, config: { ...v.config, groupByFieldId: field.id } }
                      : v
                  )
                : next
            })
          }
        />
      </div>
    )
  }

  const groups = groupRecords(table.records, groupField)
  const activeRecord = table.records.find((r) => r.id === activeRecordId)

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        table={table}
        config={config}
        selectFields={selectFields}
        patchConfig={patchConfig}
      />
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex h-full items-start gap-3 p-3">
            {groups.map((group) => (
              <KanbanColumn
                key={group.key}
                group={group}
                cardFields={cardFields}
                titleField={table.fields[0]}
                onOpenRecord={onOpenRecord}
                onAddCard={() =>
                  update((p) =>
                    ops.addRecord(
                      p,
                      group.key === UNCATEGORIZED ? {} : { [groupField.id]: group.key }
                    )
                  )
                }
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        <DragOverlay dropAnimation={null}>
          {activeRecord && (
            <KanbanCard
              record={activeRecord}
              cardFields={cardFields}
              titleField={table.fields[0]}
              className="rotate-2 shadow-lg"
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function Toolbar({
  table,
  config,
  selectFields,
  patchConfig
}: {
  table: Table
  config: KanbanViewType['config']
  selectFields: Field[]
  patchConfig: (patch: Partial<KanbanViewType['config']>) => void
}): React.JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <GroupSelect
        fields={selectFields}
        value={config.groupByFieldId}
        onChange={(groupByFieldId) => patchConfig({ groupByFieldId })}
        label="Group"
        noneLabel="No grouping"
      />
      <FieldsPopover
        fields={table.fields}
        hiddenFieldIds={config.hiddenFieldIds}
        onChange={(hiddenFieldIds) => patchConfig({ hiddenFieldIds })}
        lockedFieldId={table.fields[0]?.id}
      />
    </div>
  )
}

function KanbanColumn({
  group,
  cardFields,
  titleField,
  onOpenRecord,
  onAddCard
}: {
  group: RecordGroup
  cardFields: Field[]
  titleField?: Field
  onOpenRecord: (recordId: string) => void
  onAddCard: () => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: group.key })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex max-h-full w-72 shrink-0 flex-col rounded-lg border bg-muted/40 transition-colors',
        isOver && 'border-ring bg-accent'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {group.choice ? (
          <ChoiceBadge choice={group.choice} />
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{group.label}</span>
        )}
        <span className="text-xs tabular-nums text-muted-foreground">{group.records.length}</span>
      </div>
      <div className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-1">
        {group.records.map((record) => (
          <DraggableCard
            key={record.id}
            record={record}
            cardFields={cardFields}
            titleField={titleField}
            onOpen={() => onOpenRecord(record.id)}
          />
        ))}
      </div>
      <button
        className="mx-2 mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onAddCard}
      >
        <Plus className="size-3.5" />
        New
      </button>
    </div>
  )
}

function DraggableCard({
  record,
  cardFields,
  titleField,
  onOpen
}: {
  record: RecordRow
  cardFields: Field[]
  titleField?: Field
  onOpen: () => void
}): React.JSX.Element {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: record.id })

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && 'opacity-40')}>
      <KanbanCard
        record={record}
        cardFields={cardFields}
        titleField={titleField}
        onClick={onOpen}
      />
    </div>
  )
}

function KanbanCard({
  record,
  cardFields,
  titleField,
  onClick,
  className
}: {
  record: RecordRow
  cardFields: Field[]
  titleField?: Field
  onClick?: () => void
  className?: string
}): React.JSX.Element {
  const tables = useProjectTables()
  const title = titleField ? displayValue(titleField, record.values[titleField.id], tables) : ''
  const detailFields = cardFields.filter(
    (f) => f.id !== titleField?.id && !isEmptyValue(f, record.values[f.id])
  )

  return (
    <div
      className={cn(
        'rounded-md border bg-card p-2.5 shadow-xs transition-shadow hover:shadow-sm',
        className
      )}
      onClick={onClick}
    >
      <div className={cn('text-[13px] font-medium', !title && 'text-muted-foreground')}>
        {title || 'Untitled'}
      </div>
      {detailFields.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {detailFields.map((field) =>
            field.type === 'image' ? (
              <img
                key={field.id}
                src={String(record.values[field.id])}
                alt=""
                className="h-28 w-full rounded-sm border object-cover"
              />
            ) : (
              <div key={field.id} className="flex min-w-0 text-xs text-muted-foreground">
                <ValueDisplay field={field} value={record.values[field.id]} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
