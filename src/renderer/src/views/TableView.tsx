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
import { SummaryBar } from '@/components/SummaryBar'
import {
  getFindCellState,
  useViewFind,
  ViewFindControl,
  type ViewFindController
} from '@/components/ViewFind'
import { AudioEditor } from '@/components/editors/AudioEditor'
import { DateEditor } from '@/components/editors/DateEditor'
import { ImageEditor } from '@/components/editors/ImageEditor'
import { RelationEditor } from '@/components/editors/RelationEditor'
import { SelectEditor } from '@/components/editors/SelectEditor'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { SortPopover } from '@/components/toolbar/SortPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { RowHeightSelect } from '@/components/toolbar/RowHeightSelect'
import { applyFilters, applySorts, groupRecords, type RecordGroup } from '@/lib/derive'
import { fieldTypeInfo } from '@/lib/fields'
import * as ops from '@/lib/ops'
import { useProjectTables } from '@/lib/relations'
import type { TableUpdater } from '@/lib/queries'
import { rowHeightInfo, type RowHeightInfo } from '@/lib/rowHeight'
import { useFileDrop } from '@/lib/useFileDrop'
import { useGridClipboard } from '@/lib/useGridClipboard'
import { cn } from '@/lib/utils'

type TableViewType = Extract<View, { type: 'table' }>
type CellAddress = { recordId: string; fieldId: string }
type CellMove = 'up' | 'down' | 'left' | 'right' | 'next' | 'previous'
type EditingCell = CellAddress & { seed?: string }

const DEFAULT_COLUMN_WIDTH = 176
const MIN_COLUMN_WIDTH = 100
const MAX_COLUMN_WIDTH = 600
/** Row-number column, in pixels — `w-11`, which the summary bar has to match. */
const GUTTER_WIDTH = 44

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
  // Sorting and grouping by a relation field compares the labels of the
  // linked records, which live in a sibling table.
  const tables = useProjectTables()
  const [fieldDialog, setFieldDialog] = useState<{ field?: Field; insertIndex?: number } | null>(
    null
  )
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<Field | null>(null)
  const [selectedCell, setSelectedCell] = useState<CellAddress | null>(null)
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [liveWidth, setLiveWidth] = useState<{ fieldId: string; width: number } | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const tableRef = useRef<HTMLTableElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const summaryBarRef = useRef<HTMLDivElement>(null)

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
  // Popover editors (select/date/image/audio/relation) render into a portal outside
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
    applyFilters(table.records, config.filters, table.fields, config.filterMatch),
    config.sorts,
    table.fields,
    tables
  )
  const groups: RecordGroup[] | null = groupField
    ? groupRecords(derived, groupField, tables).filter((g) => g.records.length > 0)
    : null
  const displayedRecords = groups ? groups.flatMap((group) => group.records) : derived
  const find = useViewFind(displayedRecords, visibleFields, tables)

  // ⌘C copies the checked rows, or the selected cell; ⌘V writes a block from
  // any spreadsheet in, starting at the selected cell.
  useGridClipboard({
    records: displayedRecords,
    fields: visibleFields,
    tables,
    selectedCell,
    selectedRowIds,
    update
  })

  const moveCell = (cell: CellAddress, move: CellMove): void => {
    const rowIndex = displayedRecords.findIndex((record) => record.id === cell.recordId)
    const columnIndex = visibleFields.findIndex((field) => field.id === cell.fieldId)
    if (rowIndex < 0 || columnIndex < 0) return

    let nextRow = rowIndex
    let nextColumn = columnIndex
    if (move === 'next' || move === 'previous') {
      const currentIndex = rowIndex * visibleFields.length + columnIndex
      const nextIndex = currentIndex + (move === 'next' ? 1 : -1)
      if (nextIndex < 0 || nextIndex >= displayedRecords.length * visibleFields.length) return
      nextRow = Math.floor(nextIndex / visibleFields.length)
      nextColumn = nextIndex % visibleFields.length
    } else {
      if (move === 'up') nextRow -= 1
      if (move === 'down') nextRow += 1
      if (move === 'left') nextColumn -= 1
      if (move === 'right') nextColumn += 1
      if (
        nextRow < 0 ||
        nextRow >= displayedRecords.length ||
        nextColumn < 0 ||
        nextColumn >= visibleFields.length
      ) {
        return
      }
    }

    setSelectedCell({
      recordId: displayedRecords[nextRow].id,
      fieldId: visibleFields[nextColumn].id
    })
  }

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      !selectedCell ||
      editingCell ||
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return
    }

    const moves: Partial<Record<string, CellMove>> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right'
    }
    const arrowMove = moves[event.key]
    if (arrowMove) {
      event.preventDefault()
      moveCell(selectedCell, arrowMove)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      moveCell(selectedCell, event.shiftKey ? 'previous' : 'next')
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      moveCell(selectedCell, event.shiftKey ? 'up' : 'down')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setSelectedCell(null)
      return
    }

    const field = visibleFields.find((candidate) => candidate.id === selectedCell.fieldId)
    const record = displayedRecords.find((candidate) => candidate.id === selectedCell.recordId)
    if (!field || !record) return

    if (event.key === ' ' && field.type === 'checkbox') {
      event.preventDefault()
      update((project) =>
        ops.setRecordValue(project, record.id, field.id, record.values[field.id] !== true)
      )
      return
    }

    const isTextField = field.type === 'text' || field.type === 'url'
    const isNumberCharacter = field.type === 'number' && /^[0-9eE+.-]$/.test(event.key)
    if (event.key.length === 1 && (isTextField || isNumberCharacter)) {
      event.preventDefault()
      setEditingCell({ ...selectedCell, seed: event.key })
    }
  }

  // A filter, hidden-field change, or remote deletion can remove the active
  // cell. Do not leave keyboard navigation pointing at an invisible address.
  useEffect(() => {
    if (!selectedCell) return
    const recordIsVisible = displayedRecords.some((record) => record.id === selectedCell.recordId)
    const fieldIsVisible = visibleFields.some((field) => field.id === selectedCell.fieldId)
    if (!recordIsVisible || !fieldIsVisible) {
      setSelectedCell(null)
      setEditingCell(null)
    }
  }, [displayedRecords, selectedCell, visibleFields])

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
              editing={
                editingCell?.recordId === record.id && editingCell?.fieldId === field.id
              }
              editSeed={
                editingCell?.recordId === record.id && editingCell?.fieldId === field.id
                  ? editingCell.seed
                  : undefined
              }
              find={find}
              onSelect={() => setSelectedCell({ recordId: record.id, fieldId: field.id })}
              onEdit={(seed) => {
                setSelectedCell({ recordId: record.id, fieldId: field.id })
                setEditingCell({ recordId: record.id, fieldId: field.id, seed })
              }}
              onCommit={(move) => {
                setEditingCell(null)
                if (move) moveCell({ recordId: record.id, fieldId: field.id }, move)
              }}
              onCancel={() => setEditingCell(null)}
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
          match={config.filterMatch}
          onMatchChange={(filterMatch) => patchConfig({ filterMatch })}
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
        <ViewFindControl find={find} />
      </div>

      <div
        ref={gridRef}
        className="min-h-0 flex-1 overflow-auto"
        // The summary bar sits outside this container so it stays pinned to the
        // bottom; keeping its scroll position in step is what lines its cells up
        // with the columns.
        onScroll={(e) => {
          if (summaryBarRef.current) summaryBarRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        onKeyDown={handleGridKeyDown}
      >
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

      <SummaryBar
        fields={visibleFields}
        records={derived}
        tables={tables}
        summaries={config.summaries}
        columnWidth={columnWidth}
        gutterWidth={GUTTER_WIDTH}
        onChange={(fieldId, key) =>
          patchConfig({ summaries: { ...config.summaries, [fieldId]: key } })
        }
        scrollRef={summaryBarRef}
      />

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
  editing,
  editSeed,
  find,
  onSelect,
  onEdit,
  onCommit,
  onCancel
}: {
  projectId: string
  field: Field
  record: RecordRow
  update: TableUpdater
  heightInfo: RowHeightInfo
  width: number
  selected: boolean
  editing: boolean
  editSeed?: string
  find: ViewFindController
  onSelect: () => void
  onEdit: (seed?: string) => void
  onCommit: (move?: CellMove) => void
  onCancel: () => void
}): React.JSX.Element {
  const value = record.values[field.id]
  const findState = getFindCellState(find, record.id, field.id)
  const cellRef = useRef<HTMLTableCellElement>(null)
  const setValue = (next: unknown): void =>
    update((p) => ops.setRecordValue(p, record.id, field.id, next))

  useEffect(() => {
    if (!selected || editing) return
    const control = cellRef.current?.querySelector<HTMLElement>('[data-grid-cell-control]')
    control?.focus({ preventScroll: true })
    cellRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [editing, selected])

  return (
    <td
      ref={cellRef}
      style={{ width, minWidth: width, maxWidth: width }}
      data-find-active={findState.active ? 'true' : undefined}
      className={cn(
        heightInfo.rowClass,
        'border-b border-r p-0',
        findState.matched && 'bg-find-match-background',
        findState.active && 'ring-4 ring-inset ring-find-highlight'
      )}
    >
      <CellContent
        projectId={projectId}
        field={field}
        value={value}
        onChange={setValue}
        lineClamp={heightInfo.lineClamp}
        selected={selected}
        editing={editing}
        editSeed={editSeed}
        onSelect={onSelect}
        onEdit={onEdit}
        onCommit={onCommit}
        onCancel={onCancel}
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
  editing,
  editSeed,
  onSelect,
  onEdit,
  onCommit,
  onCancel
}: {
  projectId: string
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  lineClamp: number
  selected: boolean
  editing: boolean
  editSeed?: string
  onSelect: () => void
  onEdit: (seed?: string) => void
  onCommit: (move?: CellMove) => void
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const wrap = lineClamp > 1
  const anchorRef = useRef<HTMLDivElement>(null)
  const editFinishedRef = useRef(false)
  const isFileField = field.type === 'image' || field.type === 'audio'
  const fileDrop = useFileDrop(field.type === 'audio' ? 'audio' : 'image', projectId, onChange)

  useEffect(() => {
    if (!editing || !['text', 'number', 'url'].includes(field.type)) return
    editFinishedRef.current = false
    setDraft(
      editSeed ??
        (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
    )
  }, [editSeed, editing, field.type, value])

  if (field.type === 'checkbox') {
    return (
      <div
        className={cn(
          'flex h-full px-2',
          wrap ? 'items-start pt-1.5' : 'items-center',
          selected && 'ring-2 ring-inset ring-ring'
        )}
      >
        <Checkbox
          data-grid-cell-control
          tabIndex={selected ? 0 : -1}
          checked={value === true}
          onClick={onSelect}
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
    field.type === 'audio' ||
    field.type === 'relation'
  ) {
    return (
      <Popover open={editing} onOpenChange={(open) => (open ? onEdit() : onCancel())}>
        <div
          ref={anchorRef}
          data-grid-cell-control
          role="button"
          tabIndex={selected ? 0 : -1}
          className={cn(
            'flex h-full w-full cursor-default overflow-hidden px-2 text-left',
            wrap ? 'flex-wrap content-start items-start gap-1 py-1.5' : 'items-center',
            selected && !editing && 'ring-2 ring-inset ring-ring',
            isFileField && fileDrop.isOver && 'bg-accent ring-2 ring-inset ring-primary'
          )}
          onClick={onSelect}
          onDoubleClick={() => onEdit()}
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
              : field.type === 'date' || field.type === 'relation'
                ? 'w-64'
                : 'w-52'
          )}
          align="start"
          sideOffset={-4}
          anchor={anchorRef}
        >
          {field.type === 'date' ? (
            <DateEditor value={value} onChange={onChange} onDone={() => onCommit()} />
          ) : field.type === 'image' ? (
            <ImageEditor projectId={projectId} value={value} onChange={onChange} />
          ) : field.type === 'audio' ? (
            <AudioEditor projectId={projectId} value={value} onChange={onChange} />
          ) : field.type === 'relation' ? (
            <RelationEditor
              field={field}
              value={value}
              onChange={onChange}
              onDone={() => onCommit()}
            />
          ) : (
            <SelectEditor
              field={field}
              value={value}
              multi={field.type === 'multiSelect'}
              onChange={onChange}
              onDone={() => onCommit()}
            />
          )}
        </PopoverContent>
      </Popover>
    )
  }

  // Inline text-style editing for text / number / url.
  if (editing) {
    const commit = (move?: CellMove): void => {
      if (editFinishedRef.current) return
      editFinishedRef.current = true
      if (field.type === 'number') {
        const parsed = Number(draft)
        onChange(draft.trim() === '' || Number.isNaN(parsed) ? undefined : parsed)
      } else {
        onChange(draft)
      }
      onCommit(move)
    }
    const cancel = (): void => {
      editFinishedRef.current = true
      onCancel()
    }
    if (field.type === 'text' && wrap) {
      return (
        <textarea
          autoFocus
          className="h-full w-full resize-none bg-background px-2 py-1.5 outline-none ring-1 ring-inset ring-ring"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit('down')
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              commit(e.shiftKey ? 'previous' : 'next')
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              cancel()
            }
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
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(e.shiftKey ? 'up' : 'down')
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            commit(e.shiftKey ? 'previous' : 'next')
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }
        }}
      />
    )
  }

  return (
    <button
      data-grid-cell-control
      tabIndex={selected ? 0 : -1}
      className={cn(
        'flex h-full w-full overflow-hidden px-2 text-left',
        wrap ? 'items-start py-1.5' : 'items-center',
        selected && 'ring-2 ring-inset ring-ring'
      )}
      onClick={onSelect}
      onDoubleClick={() => onEdit()}
    >
      <ValueDisplay field={field} value={value} lineClamp={lineClamp} />
    </button>
  )
}
