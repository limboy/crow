import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { Field, Table, RecordRow, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { ChoiceBadge } from '@/components/ChoiceBadge'
import { ValueDisplay } from '@/components/ValueDisplay'
import { FieldDialog } from '@/components/FieldDialog'
import { AudioEditor } from '@/components/editors/AudioEditor'
import { DateEditor } from '@/components/editors/DateEditor'
import { ImageEditor } from '@/components/editors/ImageEditor'
import { SelectEditor } from '@/components/editors/SelectEditor'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { SortPopover } from '@/components/toolbar/SortPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { RowHeightSelect } from '@/components/toolbar/RowHeightSelect'
import { applyFilters, applySorts, groupRecords, type RecordGroup } from '@/lib/derive'
import { fieldTypeInfo } from '@/lib/fields'
import * as ops from '@/lib/ops'
import type { TableUpdater } from '@/lib/queries'
import { rowHeightInfo, type RowHeightInfo } from '@/lib/rowHeight'
import { useFileDrop } from '@/lib/useFileDrop'
import { cn } from '@/lib/utils'

type TableViewType = Extract<View, { type: 'table' }>

const DEFAULT_COLUMN_WIDTH = 176
const MIN_COLUMN_WIDTH = 100
const MAX_COLUMN_WIDTH = 600

export function TableView({
  projectId,
  table,
  view,
  update,
  onOpenRecord
}: {
  projectId: string
  table: Table
  view: TableViewType
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const config = view.config
  const [fieldDialog, setFieldDialog] = useState<{ field?: Field; insertIndex?: number } | null>(
    null
  )
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<Field | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ recordId: string; fieldId: string } | null>(
    null
  )
  const [liveWidth, setLiveWidth] = useState<{ fieldId: string; width: number } | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const tableRef = useRef<HTMLTableElement>(null)

  // Drop selections for records that no longer exist (deleted elsewhere, e.g.
  // via the record detail sheet) so stale ids don't linger in the set.
  useEffect(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev
      const validIds = new Set(table.records.map((r) => r.id))
      let changed = false
      const next = new Set<string>()
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [table.records])

  // Clicking anywhere outside the table clears the selected-cell highlight.
  // Popover editors (select/date/image/audio) render into a portal outside
  // the table DOM, so a click inside one of those doesn't count as "outside".
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (tableRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-slot="popover-content"]')) return
      setSelectedCell(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const visibleFields = table.fields.filter((f) => !config.hiddenFieldIds.includes(f.id))
  const groupField = table.fields.find((f) => f.id === config.groupByFieldId)

  const derived = applySorts(
    applyFilters(table.records, config.filters, table.fields),
    config.sorts,
    table.fields
  )
  const groups: RecordGroup[] | null = groupField
    ? groupRecords(derived, groupField).filter((g) => g.records.length > 0)
    : null

  const selectedVisibleCount = derived.reduce(
    (count, r) => (selectedRowIds.has(r.id) ? count + 1 : count),
    0
  )
  const allVisibleSelected = derived.length > 0 && selectedVisibleCount === derived.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  const toggleRowSelected = (recordId: string, checked: boolean): void => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(recordId)
      else next.delete(recordId)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean): void => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      derived.forEach((r) => (checked ? next.add(r.id) : next.delete(r.id)))
      return next
    })
  }

  const deleteSelectedRows = async (): Promise<void> => {
    const count = selectedRowIds.size
    const confirmed = await window.api.showConfirmDialog({
      title: `Delete ${count} record${count === 1 ? '' : 's'}?`,
      message: `Delete ${count} record${count === 1 ? '' : 's'}?`,
      detail: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!confirmed) return
    update((p) => ops.deleteRecords(p, Array.from(selectedRowIds)))
    setSelectedRowIds(new Set())
  }

  const deleteSingleRecord = async (recordId: string): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog({
      title: 'Delete record?',
      message: 'Delete record?',
      detail: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!confirmed) return
    update((p) => ops.deleteRecord(p, recordId))
  }

  const openRowContextMenu = (record: RecordRow) => async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    // Insert above/below splice into the underlying record order, which is
    // meaningless once a sort reorders how rows actually display.
    const isSorted = config.sorts.length > 0
    const action = await window.api.showContextMenu([
      { id: 'expand', label: 'Expand record' },
      { id: 'sep-1', label: '', type: 'separator' },
      ...(isSorted
        ? []
        : [
            { id: 'insert-above', label: 'Insert record above' },
            { id: 'insert-below', label: 'Insert record below' }
          ]),
      { id: 'duplicate', label: 'Duplicate record' },
      { id: 'sep-2', label: '', type: 'separator' },
      { id: 'delete', label: 'Delete record', danger: true }
    ])
    switch (action) {
      case 'insert-above':
        update((p) => ops.insertRecordAbove(p, record.id))
        break
      case 'insert-below':
        update((p) => ops.insertRecordBelow(p, record.id))
        break
      case 'duplicate':
        update((p) => ops.duplicateRecord(p, record.id))
        break
      case 'expand':
        onOpenRecord(record.id)
        break
      case 'delete':
        void deleteSingleRecord(record.id)
        break
    }
  }

  const patchConfig = (patch: Partial<TableViewType['config']>): void => {
    update((p) =>
      ops.patchView(p, view.id, (v) =>
        v.type === 'table' ? { ...v, config: { ...v.config, ...patch } } : v
      )
    )
  }

  const columnWidth = (fieldId: string): number =>
    liveWidth?.fieldId === fieldId
      ? liveWidth.width
      : (config.columnWidths?.[fieldId] ?? DEFAULT_COLUMN_WIDTH)

  // Drop the local drag override only once the persisted config has actually
  // caught up to it — clearing it eagerly on mouseup can render one frame
  // against the still-stale prop value, flashing back to the old width
  // before the update lands.
  useEffect(() => {
    if (liveWidth && config.columnWidths?.[liveWidth.fieldId] === liveWidth.width) {
      setLiveWidth(null)
    }
  }, [config.columnWidths, liveWidth])

  const startResize = (fieldId: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnWidth(fieldId)
    const clamp = (w: number): number =>
      Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, w))

    const onMove = (ev: MouseEvent): void => {
      setLiveWidth({ fieldId, width: clamp(startWidth + (ev.clientX - startX)) })
    }
    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const width = clamp(startWidth + (ev.clientX - startX))
      setLiveWidth({ fieldId, width })
      patchConfig({ columnWidths: { ...config.columnWidths, [fieldId]: width } })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const groupableFields = table.fields.filter((f) => f.type !== 'image' && f.type !== 'audio')
  const heightInfo = rowHeightInfo(config.rowHeight)

  let rowNumber = 0

  const renderRows = (records: RecordRow[]): React.JSX.Element[] =>
    records.map((record) => {
      rowNumber += 1
      const number = rowNumber
      const isSelected = selectedRowIds.has(record.id)
      return (
        <tr
          key={record.id}
          className={cn(
            'group/row border-b transition-colors hover:bg-muted/40',
            isSelected && 'bg-accent/40'
          )}
          onContextMenu={(e) => void openRowContextMenu(record)(e)}
        >
          <td
            className={cn(
              heightInfo.rowClass,
              'sticky left-0 z-[1] w-11 min-w-11 border-b border-r bg-background text-center',
              heightInfo.lineClamp > 1 ? 'align-top pt-1.5' : 'align-middle',
              isSelected
                ? 'bg-accent/40'
                : 'group-hover/row:bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]'
            )}
          >
            <span
              className={cn(
                'text-xs tabular-nums text-muted-foreground',
                isSelected ? 'invisible' : 'group-hover/row:invisible'
              )}
            >
              {number}
            </span>
            <div
              className={cn(
                'absolute inset-0 justify-center',
                heightInfo.lineClamp > 1 ? 'items-start pt-1.5' : 'items-center',
                isSelected ? 'flex' : 'hidden group-hover/row:flex'
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) => toggleRowSelected(record.id, checked === true)}
              />
            </div>
          </td>
          {visibleFields.map((field) => (
            <TableCell
              key={field.id}
              projectId={projectId}
              field={field}
              record={record}
              update={update}
              heightInfo={heightInfo}
              width={columnWidth(field.id)}
              selected={
                selectedCell?.recordId === record.id && selectedCell?.fieldId === field.id
              }
              onSelect={() => setSelectedCell({ recordId: record.id, fieldId: field.id })}
            />
          ))}
          <td />
        </tr>
      )
    })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <FieldsPopover
          fields={table.fields}
          hiddenFieldIds={config.hiddenFieldIds}
          onChange={(hiddenFieldIds) => patchConfig({ hiddenFieldIds })}
        />
        <FilterPopover
          fields={table.fields}
          filters={config.filters}
          onChange={(filters) => patchConfig({ filters })}
        />
        <SortPopover
          fields={table.fields}
          sorts={config.sorts}
          onChange={(sorts) => patchConfig({ sorts })}
        />
        <GroupSelect
          fields={groupableFields}
          value={config.groupByFieldId}
          onChange={(groupByFieldId) => patchConfig({ groupByFieldId })}
        />
        <RowHeightSelect
          value={config.rowHeight}
          onChange={(rowHeight) => patchConfig({ rowHeight })}
        />
        {selectedRowIds.size > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selectedRowIds.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[13px] font-normal"
              onClick={() => void deleteSelectedRows()}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">
            {derived.length === table.records.length
              ? null
              : `${derived.length} of ${table.records.length} records`}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table ref={tableRef} className="min-w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="sticky left-0 z-20 h-8 w-11 min-w-11 border-b border-r bg-background">
                {derived.length > 0 && (
                  <div className="flex h-full items-center justify-center">
                    <Checkbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    />
                  </div>
                )}
              </th>
              {visibleFields.map((field) => {
                const info = fieldTypeInfo(field.type)
                const width = columnWidth(field.id)
                return (
                  <th
                    key={field.id}
                    style={{ width, minWidth: width, maxWidth: width }}
                    className="relative h-8 border-b border-r p-0 text-left font-normal"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button className="flex h-full w-full items-center gap-1.5 px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                            <info.icon className="size-3.5 shrink-0" />
                            <span className="truncate">{field.name}</span>
                            <ChevronDown className="ml-auto size-3 shrink-0 opacity-50" />
                          </button>
                        }
                      />
                      <DropdownMenuContent align="start" className="w-auto min-w-32">
                        <DropdownMenuItem onClick={() => setFieldDialog({ field })}>
                          Edit field
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            const index = table.fields.findIndex((f) => f.id === field.id)
                            setFieldDialog({ insertIndex: index })
                          }}
                        >
                          Insert left
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const index = table.fields.findIndex((f) => f.id === field.id)
                            setFieldDialog({ insertIndex: index + 1 })
                          }}
                        >
                          Insert right
                        </DropdownMenuItem>
                        {table.fields.length > 1 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteFieldTarget(field)}
                            >
                              Delete field
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      onMouseDown={startResize(field.id)}
                      className="group absolute inset-y-0 right-0 w-2 -mr-1 cursor-col-resize touch-none select-none"
                    >
                      <div className="mx-auto h-full w-0.5 bg-transparent group-hover:bg-ring/50 group-active:bg-ring" />
                    </div>
                  </th>
                )
              })}
              {/* Unconstrained trailing column: absorbs leftover width so the fixed
                  data columns above never get stretched or squeezed to compensate. */}
              <th className="h-8 border-b p-0 text-left">
                <button
                  className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setFieldDialog({})}
                  title="Add field"
                >
                  <Plus className="size-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map((group) => (
                  <GroupSection key={group.key} group={group} colSpan={visibleFields.length + 2}>
                    {renderRows(group.records)}
                  </GroupSection>
                ))
              : renderRows(derived)}
            <tr>
              <td colSpan={visibleFields.length + 2} className="p-0">
                <button
                  className="flex h-9 w-full items-center gap-1.5 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                  onClick={() => update((p) => ops.addRecord(p))}
                >
                  <Plus className="size-3.5" />
                  New record
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <FieldDialog
        open={fieldDialog !== null}
        onOpenChange={(open) => !open && setFieldDialog(null)}
        field={fieldDialog?.field}
        onSubmit={(field) =>
          update((p) =>
            fieldDialog?.field
              ? ops.updateField(p, field.id, field)
              : ops.addField(p, field, fieldDialog?.insertIndex)
          )
        }
      />

      <AlertDialog
        open={deleteFieldTarget !== null}
        onOpenChange={(open) => !open && setDeleteFieldTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteFieldTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the field and its values from every record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleteFieldTarget) update((p) => ops.deleteField(p, deleteFieldTarget.id))
                setDeleteFieldTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function GroupSection({
  group,
  colSpan,
  children
}: {
  group: RecordGroup
  colSpan: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <tr className="border-b bg-muted/60">
        <td colSpan={colSpan} className="border-b px-3 py-1.5">
          <span className="flex items-center gap-2">
            {group.choice ? (
              <ChoiceBadge choice={group.choice} />
            ) : (
              <span className="text-xs font-medium">{group.label}</span>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">
              {group.records.length}
            </span>
          </span>
        </td>
      </tr>
      {children}
    </>
  )
}

function TableCell({
  projectId,
  field,
  record,
  update,
  heightInfo,
  width,
  selected,
  onSelect
}: {
  projectId: string
  field: Field
  record: RecordRow
  update: TableUpdater
  heightInfo: RowHeightInfo
  width: number
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const value = record.values[field.id]
  const setValue = (next: unknown): void =>
    update((p) => ops.setRecordValue(p, record.id, field.id, next))

  return (
    <td
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn(heightInfo.rowClass, 'border-b border-r p-0')}
    >
      <CellContent
        projectId={projectId}
        field={field}
        value={value}
        onChange={setValue}
        lineClamp={heightInfo.lineClamp}
        selected={selected}
        onSelect={onSelect}
      />
    </td>
  )
}

function CellContent({
  projectId,
  field,
  value,
  onChange,
  lineClamp,
  selected,
  onSelect
}: {
  projectId: string
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  lineClamp: number
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const wrap = lineClamp > 1
  const anchorRef = useRef<HTMLDivElement>(null)
  const isFileField = field.type === 'image' || field.type === 'audio'
  const fileDrop = useFileDrop(field.type === 'audio' ? 'audio' : 'image', projectId, onChange)

  if (field.type === 'checkbox') {
    return (
      <div className={cn('flex h-full px-2', wrap ? 'items-start pt-1.5' : 'items-center')}>
        <Checkbox
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      </div>
    )
  }

  // Popover-based editors: anchored to the cell, opened by clicking it.
  if (
    field.type === 'select' ||
    field.type === 'multiSelect' ||
    field.type === 'date' ||
    field.type === 'image' ||
    field.type === 'audio'
  ) {
    return (
      <Popover open={editing} onOpenChange={setEditing}>
        <div
          ref={anchorRef}
          role="button"
          tabIndex={0}
          className={cn(
            'flex h-full w-full cursor-default overflow-hidden px-2 text-left',
            wrap ? 'flex-wrap content-start items-start gap-1 py-1.5' : 'items-center',
            selected && !editing && 'ring-2 ring-inset ring-ring',
            isFileField && fileDrop.isOver && 'bg-accent ring-2 ring-inset ring-primary'
          )}
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect()
            }
          }}
          {...(isFileField
            ? {
                onDragOver: fileDrop.onDragOver,
                onDragLeave: fileDrop.onDragLeave,
                onDrop: fileDrop.onDrop
              }
            : undefined)}
        >
          <ValueDisplay field={field} value={value} lineClamp={lineClamp} />
        </div>
        <PopoverContent
          className={cn(
            'p-0',
            field.type === 'image' || field.type === 'audio'
              ? 'w-72 p-3'
              : field.type === 'date'
                ? 'w-64'
                : 'w-52'
          )}
          align="start"
          sideOffset={-4}
          anchor={anchorRef}
        >
          {field.type === 'date' ? (
            <DateEditor value={value} onChange={onChange} onDone={() => setEditing(false)} />
          ) : field.type === 'image' ? (
            <ImageEditor projectId={projectId} value={value} onChange={onChange} />
          ) : field.type === 'audio' ? (
            <AudioEditor projectId={projectId} value={value} onChange={onChange} />
          ) : (
            <SelectEditor
              field={field}
              value={value}
              multi={field.type === 'multiSelect'}
              onChange={onChange}
              onDone={() => setEditing(false)}
            />
          )}
        </PopoverContent>
      </Popover>
    )
  }

  // Inline text-style editing for text / number / url.
  if (editing) {
    const commit = (): void => {
      setEditing(false)
      if (field.type === 'number') {
        onChange(draft.trim() === '' ? undefined : Number(draft))
      } else {
        onChange(draft)
      }
    }
    if (field.type === 'text' && wrap) {
      return (
        <textarea
          autoFocus
          className="h-full w-full resize-none bg-background px-2 py-1.5 outline-none ring-1 ring-inset ring-ring"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      )
    }
    return (
      <input
        autoFocus
        type={field.type === 'number' ? 'number' : 'text'}
        className="h-full w-full bg-background px-2 outline-none ring-2 ring-inset ring-ring"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      className={cn(
        'flex h-full w-full overflow-hidden px-2 text-left',
        wrap ? 'items-start py-1.5' : 'items-center',
        selected && 'ring-2 ring-inset ring-ring'
      )}
      onClick={onSelect}
      onDoubleClick={() => {
        setDraft(
          typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
        )
        setEditing(true)
      }}
    >
      <ValueDisplay field={field} value={value} lineClamp={lineClamp} />
    </button>
  )
}
