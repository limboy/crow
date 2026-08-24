import { newRecord, newView } from '@shared/defaults'
import type { Field, RecordRow, Table } from '@shared/types'
import { cellToText, inferFieldType, parseCellText } from './cellText'

/**
 * Turning a CSV into a table, and a table back into CSV rows. The shape either
 * direction is the obvious one — a header row of field names, then one row per
 * record — so a file exported from Crow imports back into it unchanged.
 */

const isBlankRow = (row: string[]): boolean => row.every((cell) => cell.trim() === '')

/** Names the column, keeping headers unique so two `Name` columns stay apart. */
function columnName(raw: string, index: number, taken: Set<string>): string {
  const base = raw.trim() || `Column ${index + 1}`
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
  taken.add(name)
  return name
}

/**
 * Builds a table from a parsed CSV grid: the first non-blank row names the
 * columns, and each column's type is inferred from the values under it (see
 * `inferFieldType`). Returns null when there's no header to work from.
 */
export function tableFromCsv(name: string, grid: string[][]): Table | null {
  const rows = grid.filter((row) => !isBlankRow(row))
  const [header, ...body] = rows
  if (!header || header.length === 0) return null

  const taken = new Set<string>()
  const fields: Field[] = header.map((raw, index) => ({
    id: crypto.randomUUID(),
    name: columnName(raw, index, taken),
    // Ragged rows are normal in hand-edited CSVs; a missing cell is an empty one.
    type: inferFieldType(body.map((row) => row[index] ?? ''))
  }))

  const records: RecordRow[] = body.map((row) => {
    const values: Record<string, unknown> = {}
    fields.forEach((field, index) => {
      const parsed = parseCellText(field, row[index] ?? '', { choices: [], tables: [] })
      if (parsed && parsed.value !== undefined) values[field.id] = parsed.value
    })
    return newRecord(values)
  })

  return { id: crypto.randomUUID(), name, fields, records, views: [newView('table')] }
}

/** Header row plus one row per record, ready for `serializeDelimited`. */
export function csvRows(fields: Field[], records: RecordRow[], tables: Table[]): string[][] {
  return [
    fields.map((field) => field.name),
    ...records.map((record) => fields.map((field) => cellToText(field, record.values[field.id], tables)))
  ]
}
