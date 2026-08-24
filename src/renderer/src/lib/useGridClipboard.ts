import { useEffect, useRef } from 'react'
import type { Field, RecordRow, Table } from '@shared/types'
import { cellToText } from './cellText'
import { isBlankGrid, parseDelimited, serializeDelimited } from './csv'
import * as ops from './ops'
import type { TableUpdater } from './queries'
import { isTextEntry } from './utils'

/**
 * ⌘C / ⌘V for the grid, in the dialect every spreadsheet speaks: tab-separated
 * text, one line per row.
 *
 * The delimiter is always a tab rather than sniffed (as it is for a CSV file):
 * a spreadsheet always writes tabs, so anything else on the clipboard is prose,
 * and prose with a comma in it belongs in one cell rather than split across two.
 */
const CLIPBOARD_DELIMITER = '\t'

export interface GridClipboard {
  /** Records in the order the view shows them — copy walks these, and paste
   *  lands on them. */
  records: RecordRow[]
  /** Visible fields in column order. */
  fields: Field[]
  /** Sibling tables, for relation labels in either direction. */
  tables: Table[]
  selectedCell: { recordId: string; fieldId: string } | null
  selectedRowIds: Set<string>
  update: TableUpdater
}

/** The record sheet and the field dialog are modal and portalled outside the
 *  table, so they never contain the grid's own cells: while one is up, a copy
 *  or paste belongs to it and not to the rows behind it. Cell editors open in
 *  a popover, which isn't modal, so those are matched by target instead. */
const MODAL_SELECTOR = '[data-slot="sheet-content"], [data-slot="dialog-content"]'

function isOverlayEvent(target: EventTarget | null): boolean {
  if (document.querySelector(MODAL_SELECTOR)) return true
  return target instanceof Element && target.closest('[data-slot="popover-content"]') !== null
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char)

/** The same block as HTML, so word processors and Excel paste a real table
 *  where they'd otherwise paste the tab-separated text as one run. */
function htmlTable(grid: string[][]): string {
  const rows = grid.map((row) => {
    const cells = row.map(
      (cell) => `<td>${escapeHtml(cell).replaceAll('\n', '<br>') || '&nbsp;'}</td>`
    )
    return `<tr>${cells.join('')}</tr>`
  })
  return `<table>${rows.join('')}</table>`
}

/**
 * Binds copy/paste on the document rather than on the table, so it works
 * wherever focus happens to be after a click — except inside a cell editor or
 * a rename box, where the keystroke belongs to the text being typed.
 */
export function useGridClipboard(clipboard: GridClipboard): void {
  // Every field here changes on most renders (`records` is recomputed from the
  // view's filters and sorts each time), so the listeners read the latest
  // through a ref instead of being torn down and rebound continuously.
  const ref = useRef(clipboard)
  ref.current = clipboard

  useEffect(() => {
    const onCopy = (e: ClipboardEvent): void => {
      const { records, fields, tables, selectedCell, selectedRowIds } = ref.current
      if (isTextEntry(e.target) || isOverlayEvent(e.target) || !e.clipboardData) return
      // A deliberate drag-selection of text wins: that's what the user
      // highlighted, and clicking a cell collapses the selection anyway.
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return

      const rowValues = (record: RecordRow): string[] =>
        fields.map((field) => cellToText(field, record.values[field.id], tables))

      let grid: string[][]
      if (selectedRowIds.size > 0) {
        // Checked rows copy whole, in display order and columns — filtered-out
        // rows aren't on screen, so they aren't part of what was selected.
        grid = records.filter((r) => selectedRowIds.has(r.id)).map(rowValues)
      } else if (selectedCell) {
        const record = records.find((r) => r.id === selectedCell.recordId)
        const field = fields.find((f) => f.id === selectedCell.fieldId)
        if (!record || !field) return
        grid = [[cellToText(field, record.values[field.id], tables)]]
      } else {
        return
      }
      if (grid.length === 0) return

      e.preventDefault()
      e.clipboardData.setData('text/plain', serializeDelimited(grid, CLIPBOARD_DELIMITER))
      e.clipboardData.setData('text/html', htmlTable(grid))
    }

    const onPaste = (e: ClipboardEvent): void => {
      const { records, fields, tables, selectedCell, update } = ref.current
      if (isTextEntry(e.target) || isOverlayEvent(e.target) || !selectedCell) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      const grid = parseDelimited(text, CLIPBOARD_DELIMITER)
      if (grid.length === 0 || isBlankGrid(grid)) return

      e.preventDefault()
      update((table) =>
        ops.pasteCells(table, grid, {
          anchor: selectedCell,
          orderedRecordIds: records.map((r) => r.id),
          visibleFieldIds: fields.map((f) => f.id),
          tables
        })
      )
    }

    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [])
}
