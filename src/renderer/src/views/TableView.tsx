import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type {
  AudioRepeatMode,
  AudioShuffleMode,
  Field,
  Table,
  RecordRow,
  View
} from '@shared/types'
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { ChoiceBadge } from '@/components/ChoiceBadge'
import type { AudioPlayback } from '@/components/AudioPlayer'
import { RatingStars } from '@/components/RatingStars'
import { ValueDisplay } from '@/components/ValueDisplay'
import { FieldDialog } from '@/components/FieldDialog'
import { SummaryBar } from '@/components/SummaryBar'
import {
  getFindCellState,
  useViewFind,
  ViewFindControl,
  type ViewFindController
} from '@/components/ViewFind'
import { AttachmentEditor } from '@/components/editors/AttachmentEditor'
import { AudioEditor } from '@/components/editors/AudioEditor'
import { DateEditor } from '@/components/editors/DateEditor'
import { ImageEditor } from '@/components/editors/ImageEditor'
import { RelationEditor } from '@/components/editors/RelationEditor'
import { SelectEditor } from '@/components/editors/SelectEditor'
import { VideoEditor } from '@/components/editors/VideoEditor'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { SortPopover } from '@/components/toolbar/SortPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { RowHeightSelect } from '@/components/toolbar/RowHeightSelect'
import { applyFilters, applySorts, groupRecords, type RecordGroup } from '@/lib/derive'
import { cellValue, fieldTypeInfo, isComputedField, isEmptyValue } from '@/lib/fields'
import * as ops from '@/lib/ops'
import { useProjectTables } from '@/lib/relations'
import type { TableUpdater } from '@/lib/queries'
import { rowHeightInfo, type RowHeightInfo } from '@/lib/rowHeight'
import { updateRowSelection } from '@/lib/rowSelection'
import { useAttachmentDrop, useFileDrop } from '@/lib/useFileDrop'
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
/** Column header row, in pixels — `h-8`. It floats over the top of the scroll
 *  container, so scrolling a row into view has to clear it. */
const HEADER_HEIGHT = 32
/** Group heading row, in pixels — `h-8`, fixed so the row layout below can be
 *  computed rather than measured. */
const GROUP_HEADER_HEIGHT = 32
/** How much to render above and below the viewport, so a flick of the wheel
 *  lands on rows that are already there. */
const OVERSCAN = 320

/**
 * A row of the grid as laid out: a group heading or a record, at a known
 * offset and height. Knowing the layout up front is what lets the table render
 * only the slice of rows the viewport is actually over.
 */
type VirtualRow = { top: number; height: number } & (
  | { kind: 'group'; key: string; group: RecordGroup }
  | { kind: 'record'; record: RecordRow; number: number }
)

interface RowLayout {
  items: VirtualRow[]
  /** Every row's height added up: what the spacer rows have to add back. */
  height: number
  indexByRecordId: Map<string, number>
}

function layOutRows(
  groups: RecordGroup[] | null,
  records: RecordRow[],
  rowHeight: number
): RowLayout {
  const items: VirtualRow[] = []
  const indexByRecordId = new Map<string, number>()
  let top = 0
  let number = 0
  const pushRecord = (record: RecordRow): void => {
    number += 1
    indexByRecordId.set(record.id, items.length)
    items.push({ kind: 'record', record, number, top, height: rowHeight })
    top += rowHeight
  }

  if (groups) {
    for (const group of groups) {
      items.push({ kind: 'group', key: group.key, group, top, height: GROUP_HEADER_HEIGHT })
      top += GROUP_HEADER_HEIGHT
      for (const record of group.records) pushRecord(record)
    }
  } else {
    for (const record of records) pushRecord(record)
  }
  return { items, height: top, indexByRecordId }
}

/** The last row starting at or before `offset`. Binary search: this runs on
 *  every scroll frame, over a list as long as the table has records. */
function rowIndexAt(items: VirtualRow[], offset: number): number {
  let low = 0
  let high = items.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (items[mid].top <= offset) low = mid
    else high = mid - 1
  }
  return low
}

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
  /** The last row toggled without Shift; range selection extends from here. */
  const rowSelectionAnchorRef = useRef<string | null>(null)
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

  // Filtering, sorting and grouping run over every record in the table, so they
  // are tied to the data and the view's configuration — not to selecting a
  // cell, typing, or scrolling, which would otherwise re-sort thousands of
  // records on every keystroke.
  const visibleFields = useMemo(
    () => table.fields.filter((f) => !config.hiddenFieldIds.includes(f.id)),
    [table.fields, config.hiddenFieldIds]
  )
  const groupField = table.fields.find((f) => f.id === config.groupByFieldId)

  const derived = useMemo(
    () =>
      applySorts(
        applyFilters(table.records, config.filters, table.fields, config.filterMatch),
        config.sorts,
        table.fields,
        tables
      ),
    [table.records, table.fields, config.filters, config.filterMatch, config.sorts, tables]
  )
  const groups: RecordGroup[] | null = useMemo(
    () =>
      groupField
        ? groupRecords(derived, groupField, tables).filter((g) => g.records.length > 0)
        : null,
    [derived, groupField, tables]
  )
  const displayedRecords = useMemo(
    () => (groups ? groups.flatMap((group) => group.records) : derived),
    [groups, derived]
  )
  const displayedRecordIds = useMemo(
    () => displayedRecords.map((record) => record.id),
    [displayedRecords]
  )
  const find = useViewFind(displayedRecords, visibleFields, tables)

  const heightInfo = rowHeightInfo(config.rowHeight)

  // Only the rows the viewport is over get rendered. A few thousand records is
  // otherwise tens of thousands of cells — many of them an <img> or an
  // <audio> — for the browser to lay out and for React to walk on every
  // selection, keystroke and edit.
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const rows = useMemo(
    () => layOutRows(groups, derived, heightInfo.px),
    [groups, derived, heightInfo.px]
  )

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = (): void => setViewportHeight(el.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const firstRow = rowIndexAt(rows.items, scrollTop - OVERSCAN)
  const lastRow = rowIndexAt(rows.items, scrollTop + viewportHeight + OVERSCAN)
  const windowedRows = rows.items.slice(firstRow, lastRow + 1)
  // Empty rows standing in for everything above and below the window, so the
  // scrollbar spans the whole table and the rows in view sit at their real
  // offsets.
  const lastWindowed = windowedRows[windowedRows.length - 1]
  const topSpacer = windowedRows.length > 0 ? windowedRows[0].top : 0
  const bottomSpacer = lastWindowed ? rows.height - (lastWindowed.top + lastWindowed.height) : 0

  /** Scrolls `recordId`'s row into the viewport if it isn't already there —
   *  and, because the window follows the scroll offset, mounts it. */
  const ensureRecordVisible = useCallback(
    (recordId: string): void => {
      const el = gridRef.current
      const index = rows.indexByRecordId.get(recordId)
      if (!el || index === undefined) return
      const row = rows.items[index]
      const above = Math.max(0, row.top - HEADER_HEIGHT)
      const below = row.top + row.height - el.clientHeight
      const next = el.scrollTop > above ? above : el.scrollTop < below ? below : el.scrollTop
      if (next === el.scrollTop) return
      el.scrollTop = next
      // Render the window for where we just scrolled to as part of this same
      // update, so whatever wanted the row visible — focus, autoplay — finds
      // it mounted.
      setScrollTop(next)
    },
    [rows]
  )

  // A match can be anywhere in the table, including far outside the window, so
  // its row has to be brought in before the highlight has anything to land on.
  const activeMatch = find.matches[find.currentIndex]
  useEffect(() => {
    if (activeMatch) ensureRecordVisible(activeMatch.recordId)
  }, [activeMatch, ensureRecordVisible])

  // One playlist per audio column, over the cells that actually hold a clip.
  // Positions rather than players, since only the rows in the window exist.
  const audioPlaylists = useMemo(() => {
    const byField = new Map<string, { ids: string[]; orderById: Map<string, number> }>()
    for (const field of visibleFields) {
      if (field.type !== 'audio') continue
      const ids = displayedRecords
        .filter((record) => !isEmptyValue(field, record.values[field.id]))
        .map((record) => record.id)
      byField.set(field.id, { ids, orderById: new Map(ids.map((id, index) => [id, index])) })
    }
    return byField
  }, [visibleFields, displayedRecords])

  const [audioRequest, setAudioRequest] = useState<{
    recordId: string
    fieldId: string
    token: number
  } | null>(null)
  const audioTokenRef = useRef(0)

  const requestAudioPlay = useCallback(
    (fieldId: string, order: number): void => {
      const recordId = audioPlaylists.get(fieldId)?.ids[order]
      if (!recordId) return
      ensureRecordVisible(recordId)
      audioTokenRef.current += 1
      setAudioRequest({ recordId, fieldId, token: audioTokenRef.current })
    },
    [audioPlaylists, ensureRecordVisible]
  )

  // The player picks the request up while this update commits (a child's
  // effects run before its parent's), so clear it straight away: a row that
  // scrolls out of the window and back must not start playing again on the
  // strength of a request that was already served.
  useEffect(() => {
    if (audioRequest) setAudioRequest(null)
  }, [audioRequest])

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

    const recordId = displayedRecords[nextRow].id
    ensureRecordVisible(recordId)
    setSelectedCell({ recordId, fieldId: visibleFields[nextColumn].id })
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

    if (field.type === 'rating' && /^[1-5]$/.test(event.key)) {
      event.preventDefault()
      const rating = Number(event.key)
      update((project) =>
        ops.setRecordValue(
          project,
          record.id,
          field.id,
          record.values[field.id] === rating ? undefined : rating
        )
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

  const toggleRowSelected = (recordId: string, checked: boolean, extend = false): void => {
    // Shift-clicking a row checkbox can also extend the browser's native text
    // selection across the grid. Keep only the table's range selection visible.
    if (extend) window.getSelection()?.removeAllRanges()

    const anchorId = rowSelectionAnchorRef.current
    const canExtend = extend && anchorId !== null && displayedRecordIds.includes(anchorId)
    setSelectedRowIds((prev) =>
      updateRowSelection(prev, displayedRecordIds, anchorId, recordId, checked, canExtend)
    )
    if (!canExtend) rowSelectionAnchorRef.current = recordId
  }

  const toggleSelectAll = (checked: boolean): void => {
    rowSelectionAnchorRef.current = null
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
    rowSelectionAnchorRef.current = null
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

  const groupableFields = table.fields.filter(
    (f) =>
      f.type !== 'image' && f.type !== 'audio' && f.type !== 'video' && f.type !== 'attachment'
  )

  const renderRecordRow = (record: RecordRow, number: number): React.JSX.Element => {
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
              onMouseDown={(event) => {
                if (event.shiftKey) event.preventDefault()
              }}
              onCheckedChange={(checked, details) =>
                toggleRowSelected(
                  record.id,
                  checked === true,
                  (details.event instanceof MouseEvent ||
                    details.event instanceof KeyboardEvent) &&
                    details.event.shiftKey
                )
              }
              aria-label={`Select record ${number}`}
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
            audioPlayback={
              field.type === 'audio'
                ? {
                    groupId: `${view.id}:${field.id}`,
                    order: audioPlaylists.get(field.id)?.orderById.get(record.id) ?? 0,
                    total: audioPlaylists.get(field.id)?.ids.length ?? 0,
                    autoPlayNext:
                      config.audioPlayback?.[field.id]?.autoPlayNext ?? true,
                    repeatMode: config.audioPlayback?.[field.id]?.repeatMode ?? 'off',
                    shuffleMode: config.audioPlayback?.[field.id]?.shuffleMode ?? 'off',
                    requestPlay: (order) => requestAudioPlay(field.id, order),
                    autoPlayToken:
                      audioRequest?.recordId === record.id && audioRequest.fieldId === field.id
                        ? audioRequest.token
                        : undefined
                  }
                : undefined
            }
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
  }

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
        <div className="ml-auto flex items-center gap-2">
          {selectedRowIds.size > 0 && (
            <>
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
            </>
          )}
          <ViewFindControl find={find} />
        </div>
      </div>

      <div
        ref={gridRef}
        className="min-h-0 flex-1 overflow-auto"
        // The summary bar sits outside this container so it stays pinned to the
        // bottom; keeping its scroll position in step is what lines its cells up
        // with the columns.
        onScroll={(e) => {
          if (summaryBarRef.current) summaryBarRef.current.scrollLeft = e.currentTarget.scrollLeft
          setScrollTop(e.currentTarget.scrollTop)
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
              {visibleFields.map((field, columnIndex) => {
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
                      <DropdownMenuContent align="start" className="w-auto min-w-36">
                        <DropdownMenuItem onClick={() => setFieldDialog({ field })}>
                          Edit field
                        </DropdownMenuItem>
                        {field.type === 'audio' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem
                              checked={
                                config.audioPlayback?.[field.id]?.autoPlayNext ?? true
                              }
                              onCheckedChange={(checked) =>
                                patchConfig({
                                  audioPlayback: {
                                    ...config.audioPlayback,
                                    [field.id]: {
                                      autoPlayNext: checked === true,
                                      repeatMode:
                                        config.audioPlayback?.[field.id]?.repeatMode ?? 'off',
                                      shuffleMode:
                                        config.audioPlayback?.[field.id]?.shuffleMode ?? 'off'
                                    }
                                  }
                                })
                              }
                            >
                              Auto-play next
                            </DropdownMenuCheckboxItem>
                            {(config.audioPlayback?.[field.id]?.autoPlayNext ?? true) && (
                              <>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>Repeat mode</DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                      value={
                                        config.audioPlayback?.[field.id]?.repeatMode ?? 'off'
                                      }
                                      onValueChange={(next) =>
                                        patchConfig({
                                          audioPlayback: {
                                            ...config.audioPlayback,
                                            [field.id]: {
                                              autoPlayNext: true,
                                              repeatMode: next as AudioRepeatMode,
                                              shuffleMode:
                                                config.audioPlayback?.[field.id]?.shuffleMode ??
                                                'off'
                                            }
                                          }
                                        })
                                      }
                                    >
                                      <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
                                      <DropdownMenuRadioItem value="one">One</DropdownMenuRadioItem>
                                      <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>Shuffle mode</DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuRadioGroup
                                      value={
                                        config.audioPlayback?.[field.id]?.shuffleMode ?? 'off'
                                      }
                                      onValueChange={(next) =>
                                        patchConfig({
                                          audioPlayback: {
                                            ...config.audioPlayback,
                                            [field.id]: {
                                              autoPlayNext: true,
                                              repeatMode:
                                                config.audioPlayback?.[field.id]?.repeatMode ??
                                                'off',
                                              shuffleMode: next as AudioShuffleMode
                                            }
                                          }
                                        })
                                      }
                                    >
                                      <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
                                      <DropdownMenuRadioItem value="on">On</DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              </>
                            )}
                          </>
                        )}
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
                        {visibleFields.length > 1 && (
                          <>
                            <DropdownMenuSeparator />
                            {/* Moves the field past its visible neighbour, so a
                                hidden column in between doesn't swallow the move. */}
                            <DropdownMenuItem
                              disabled={columnIndex === 0}
                              onClick={() =>
                                update((p) =>
                                  ops.moveField(p, field.id, visibleFields[columnIndex - 1].id)
                                )
                              }
                            >
                              Move left
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={columnIndex === visibleFields.length - 1}
                              onClick={() =>
                                update((p) =>
                                  ops.moveField(p, field.id, visibleFields[columnIndex + 1].id)
                                )
                              }
                            >
                              Move right
                            </DropdownMenuItem>
                          </>
                        )}
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
            {topSpacer > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={visibleFields.length + 2}
                  style={{ height: topSpacer }}
                  className="p-0"
                />
              </tr>
            )}
            {windowedRows.map((row) =>
              row.kind === 'group' ? (
                <GroupHeadingRow
                  key={`group:${row.key}`}
                  group={row.group}
                  colSpan={visibleFields.length + 2}
                />
              ) : (
                renderRecordRow(row.record, row.number)
              )
            )}
            {bottomSpacer > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={visibleFields.length + 2}
                  style={{ height: bottomSpacer }}
                  className="p-0"
                />
              </tr>
            )}
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
              {deleteFieldTarget?.type === 'relation'
                ? `This also removes its paired field from “${
                    tables.find((candidate) => candidate.id === deleteFieldTarget.relation?.tableId)
                      ?.name ?? 'the linked table'
                  }”.`
                : 'This removes the field and its values from every record.'}
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

/** Fixed height (`h-8`, matching GROUP_HEADER_HEIGHT): the row layout the
 *  window is computed from has to know how tall this is without measuring it. */
function GroupHeadingRow({
  group,
  colSpan
}: {
  group: RecordGroup
  colSpan: number
}): React.JSX.Element {
  return (
    <tr className="border-b bg-muted/60">
      <td colSpan={colSpan} className="h-8 border-b px-3">
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
  )
}

function TableCell({
  projectId,
  field,
  record,
  update,
  heightInfo,
  width,
  audioPlayback,
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
  audioPlayback?: AudioPlayback
  selected: boolean
  editing: boolean
  editSeed?: string
  find: ViewFindController
  onSelect: () => void
  onEdit: (seed?: string) => void
  onCommit: (move?: CellMove) => void
  onCancel: () => void
}): React.JSX.Element {
  const value = cellValue(field, record)
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
        audioPlayback={audioPlayback}
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
  audioPlayback,
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
  audioPlayback?: AudioPlayback
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
  // Created/modified stamps come from the record, so their cells only display.
  const readOnly = isComputedField(field.type)
  const hasMultipleRelationRecords =
    field.type === 'relation' && Array.isArray(value) && value.length > 1
  const anchorRef = useRef<HTMLDivElement>(null)
  const editFinishedRef = useRef(false)
  const isFileField =
    field.type === 'image' ||
    field.type === 'audio' ||
    field.type === 'video' ||
    field.type === 'attachment'
  const fileDrop = useFileDrop(
    field.type === 'audio' || field.type === 'video' ? field.type : 'image',
    projectId,
    onChange
  )
  const attachmentDrop = useAttachmentDrop(projectId, value, onChange)
  const activeFileDrop = field.type === 'attachment' ? attachmentDrop : fileDrop

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

  if (field.type === 'rating') {
    return (
      <div
        data-grid-cell-control
        role="button"
        tabIndex={selected ? 0 : -1}
        className={cn('flex h-full items-center px-2', selected && 'ring-2 ring-inset ring-ring')}
        onClick={onSelect}
      >
        <RatingStars value={typeof value === 'number' ? value : 0} onChange={onChange} />
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
    field.type === 'video' ||
    field.type === 'attachment' ||
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
            !wrap && hasMultipleRelationRecords && 'py-1.5',
            selected && !editing && 'ring-2 ring-inset ring-ring',
            isFileField && activeFileDrop.isOver && 'bg-accent ring-2 ring-inset ring-primary',
            // A dropped file only reaches the cell once it's stored — and a
            // video not until its cover is captured — so the cell says so
            // meanwhile rather than looking like the drop was ignored.
            isFileField && activeFileDrop.busy && 'animate-pulse bg-accent/60'
          )}
          onClick={onSelect}
          onDoubleClick={() => onEdit()}
          {...(isFileField
            ? {
                onDragOver: activeFileDrop.onDragOver,
                onDragLeave: activeFileDrop.onDragLeave,
                onDrop: activeFileDrop.onDrop
              }
            : undefined)}
        >
          <ValueDisplay
            field={field}
            value={value}
            lineClamp={lineClamp}
            audioPlayback={audioPlayback}
          />
        </div>
        <PopoverContent
          className={cn(
            'p-0',
            field.type === 'image' ||
            field.type === 'audio' ||
            field.type === 'video' ||
            field.type === 'attachment'
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
          ) : field.type === 'video' ? (
            <VideoEditor projectId={projectId} value={value} onChange={onChange} />
          ) : field.type === 'attachment' ? (
            <AttachmentEditor projectId={projectId} value={value} onChange={onChange} />
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
  if (editing && !readOnly) {
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
      onDoubleClick={readOnly ? undefined : () => onEdit()}
    >
      <ValueDisplay field={field} value={value} lineClamp={lineClamp} />
    </button>
  )
}
