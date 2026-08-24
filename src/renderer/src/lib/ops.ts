import { newRecord, newTable, newView } from '@shared/defaults'
import {
  CREATED_AT_DATE_SOURCE,
  type Field,
  type Project,
  type RecordRow,
  type SelectChoice,
  type Table,
  type View,
  type ViewType
} from '@shared/types'
import { parseCellText } from './cellText'

/**
 * Pure transforms of the two things the app edits: a single Table (its
 * records, fields and views), applied through useUpdateTable, and the Project
 * itself (its list of tables), applied through useUpdateProject.
 */

// --- Tables -----------------------------------------------------------------

/** Returns the project unchanged when `fn` leaves the table as it was — the
 *  transforms below hand back their input when an edit doesn't apply, and
 *  callers (see useUpdateProject) use identity to tell a real edit apart from
 *  a no-op. */
export function patchTable(project: Project, tableId: string, fn: (table: Table) => Table): Project {
  let changed = false
  const tables = project.tables.map((t) => {
    if (t.id !== tableId) return t
    const next = fn(t)
    if (next !== t) changed = true
    return next
  })
  return changed ? { ...project, tables } : project
}

/** Appends a table with a name that doesn't collide with the existing ones. */
export function addTable(project: Project, name?: string): Project {
  return { ...project, tables: [...project.tables, newTable(name ?? nextTableName(project))] }
}

function nextTableName(project: Project): string {
  const taken = new Set(project.tables.map((t) => t.name))
  for (let n = project.tables.length + 1; ; n++) {
    const name = `Table ${n}`
    if (!taken.has(name)) return name
  }
}

/** Adds a table built elsewhere — a CSV import, say — rather than the starter
 *  schema `addTable` creates. */
export function insertTable(project: Project, table: Table): Project {
  return { ...project, tables: [...project.tables, table] }
}

export function renameTable(project: Project, tableId: string, name: string): Project {
  return patchTable(project, tableId, (t) => ({ ...t, name }))
}

/** Deep-copies a table so edits to the copy can't reach back into the
 *  original. Field/record/view ids are kept: they're only ever resolved
 *  within their own table, so a copy that reuses them stays self-consistent.
 *  Self-relations are re-pointed at the copy for the same reason — and since
 *  record ids are kept too, the links still resolve. */
export function duplicateTable(project: Project, tableId: string): Project {
  const index = project.tables.findIndex((t) => t.id === tableId)
  if (index === -1) return project
  const source = project.tables[index]
  const cloneId = crypto.randomUUID()
  const clone: Table = {
    ...structuredClone(source),
    id: cloneId,
    name: `${source.name} copy`
  }
  clone.fields = clone.fields.map((f) =>
    f.relation?.tableId === source.id
      ? { ...f, relation: { ...f.relation, tableId: cloneId } }
      : f
  )
  const tables = [...project.tables]
  tables.splice(index + 1, 0, clone)
  return { ...project, tables }
}

/** A project always keeps at least one table, mirroring how views work.
 *  Relation fields elsewhere that pointed at the deleted table go with it —
 *  a link into a table that's gone has nothing left to show. */
export function deleteTable(project: Project, tableId: string): Project {
  if (project.tables.length <= 1) return project
  const tables = project.tables
    .filter((t) => t.id !== tableId)
    .map((table) =>
      table.fields
        .filter((f) => f.relation?.tableId === tableId)
        .reduce((acc, field) => deleteField(acc, field.id), table)
    )
  return { ...project, tables }
}

// --- Views, records and fields, within one table ----------------------------

export function patchView(table: Table, viewId: string, fn: (view: View) => View): Table {
  return { ...table, views: table.views.map((v) => (v.id === viewId ? fn(v) : v)) }
}

export function addView(table: Table, type: ViewType): Table {
  const count = table.views.filter((v) => v.type === type).length
  const view = newView(type)
  if (view.type === 'calendar') {
    view.config.dateFieldId =
      table.fields.find((field) => field.type === 'date')?.id ?? CREATED_AT_DATE_SOURCE
  }
  if (count > 0) view.name = `${view.name} ${count + 1}`
  return { ...table, views: [...table.views, view] }
}

export function renameView(table: Table, viewId: string, name: string): Table {
  return patchView(table, viewId, (v) => ({ ...v, name }))
}

export function deleteView(table: Table, viewId: string): Table {
  if (table.views.length <= 1) return table
  return { ...table, views: table.views.filter((v) => v.id !== viewId) }
}

export function addRecord(table: Table, values: Record<string, unknown> = {}): Table {
  return { ...table, records: [...table.records, newRecord(values)] }
}

export function insertRecordAbove(table: Table, recordId: string): Table {
  const index = table.records.findIndex((r) => r.id === recordId)
  const records = [...table.records]
  records.splice(index === -1 ? records.length : index, 0, newRecord())
  return { ...table, records }
}

export function insertRecordBelow(table: Table, recordId: string): Table {
  const index = table.records.findIndex((r) => r.id === recordId)
  const records = [...table.records]
  records.splice(index === -1 ? records.length : index + 1, 0, newRecord())
  return { ...table, records }
}

export function duplicateRecord(table: Table, recordId: string): Table {
  const index = table.records.findIndex((r) => r.id === recordId)
  if (index === -1) return table
  const clone = newRecord({ ...table.records[index].values })
  const records = [...table.records]
  records.splice(index + 1, 0, clone)
  return { ...table, records }
}

export function setRecordValue(
  table: Table,
  recordId: string,
  fieldId: string,
  value: unknown
): Table {
  return {
    ...table,
    records: table.records.map((r) =>
      r.id === recordId ? { ...r, values: { ...r.values, [fieldId]: value } } : r
    )
  }
}

export function deleteRecord(table: Table, recordId: string): Table {
  return { ...table, records: table.records.filter((r) => r.id !== recordId) }
}

export function deleteRecords(table: Table, recordIds: string[]): Table {
  const ids = new Set(recordIds)
  return { ...table, records: table.records.filter((r) => !ids.has(r.id)) }
}

/** Appends `field` unless `index` is given, in which case it's inserted there. */
export function addField(table: Table, field: Field, index?: number): Table {
  const fields = [...table.fields]
  if (index === undefined || index < 0 || index >= fields.length) {
    fields.push(field)
  } else {
    fields.splice(index, 0, field)
  }
  return { ...table, fields }
}

export function updateField(table: Table, fieldId: string, patch: Partial<Field>): Table {
  return {
    ...table,
    fields: table.fields.map((f) => (f.id === fieldId ? { ...f, ...patch, id: f.id } : f))
  }
}

/** Removes the field plus every reference to it in records and view configs. */
export function deleteField(table: Table, fieldId: string): Table {
  const stripValues = (r: RecordRow): RecordRow => {
    if (!(fieldId in r.values)) return r
    const { [fieldId]: _removed, ...rest } = r.values
    return { ...r, values: rest }
  }
  const views = table.views.map((view): View => {
    const shared = {
      hiddenFieldIds: view.config.hiddenFieldIds.filter((id) => id !== fieldId),
      filters: view.config.filters.filter((f) => f.fieldId !== fieldId),
      sorts: view.config.sorts.filter((s) => s.fieldId !== fieldId)
    }
    switch (view.type) {
      case 'table':
        return {
          ...view,
          config: {
            ...view.config,
            ...shared,
            groupByFieldId:
              view.config.groupByFieldId === fieldId ? undefined : view.config.groupByFieldId
          }
        }
      case 'kanban':
        return {
          ...view,
          config: {
            ...view.config,
            ...shared,
            groupByFieldId:
              view.config.groupByFieldId === fieldId ? undefined : view.config.groupByFieldId
          }
        }
      case 'gallery':
        return {
          ...view,
          config: {
            ...view.config,
            ...shared,
            coverFieldId: view.config.coverFieldId === fieldId ? undefined : view.config.coverFieldId
          }
        }
      case 'calendar':
        return {
          ...view,
          config: {
            ...view.config,
            ...shared,
            dateFieldId: view.config.dateFieldId === fieldId ? undefined : view.config.dateFieldId
          }
        }
    }
  })
  return {
    ...table,
    fields: table.fields.filter((f) => f.id !== fieldId),
    records: table.records.map(stripValues),
    views
  }
}

// --- Clipboard --------------------------------------------------------------

/** Compares two cell values, so a paste that changes nothing doesn't leave a
 *  step in the undo history. Multi-value cells are arrays rebuilt on every
 *  parse, so identity alone isn't enough. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  }
  return false
}

export interface PasteTarget {
  /** Cell the block's top-left corner lands on. */
  anchor: { recordId: string; fieldId: string }
  /** Record ids in the order the view shows them: a paste follows what's on
   *  screen, not the underlying record order. */
  orderedRecordIds: string[]
  /** Visible field ids in column order. The block is clipped at the last one —
   *  pasting eight columns into the second-to-last writes two. */
  visibleFieldIds: string[]
  /** Sibling tables, for resolving relation labels back to record ids. */
  tables: Table[]
}

/**
 * Writes a block of pasted text into the table, starting at `anchor` and
 * spilling right and down. Rows past the end of the view are created, the way
 * a spreadsheet grows to fit what you paste into it; columns past the last
 * visible field are dropped, since there's nowhere to put them.
 *
 * The whole block lands as one transform, so it's one undo step no matter how
 * many cells it covered.
 */
export function pasteCells(table: Table, grid: string[][], target: PasteTarget): Table {
  const { anchor, orderedRecordIds, visibleFieldIds, tables } = target
  const colStart = visibleFieldIds.indexOf(anchor.fieldId)
  const rowStart = orderedRecordIds.indexOf(anchor.recordId)
  if (grid.length === 0 || colStart === -1 || rowStart === -1) return table

  const fieldsById = new Map(table.fields.map((f) => [f.id, f]))
  const recordsById = new Map(table.records.map((r) => [r.id, r]))
  /** Select choices the paste invented, per field, so the same new value
   *  repeated down a column only creates one. */
  const addedChoices = new Map<string, SelectChoice[]>()
  const patched = new Map<string, Record<string, unknown>>()
  const created: RecordRow[] = []
  const order = [...orderedRecordIds]
  let changed = false

  grid.forEach((cells, rowOffset) => {
    let recordId = order[rowStart + rowOffset]
    if (recordId === undefined) {
      const record = newRecord()
      created.push(record)
      recordsById.set(record.id, record)
      // Rows are filled in sequence, so this only ever appends.
      order[rowStart + rowOffset] = record.id
      recordId = record.id
      changed = true
    }
    const record = recordsById.get(recordId)
    if (!record) return
    const values = patched.get(recordId) ?? { ...record.values }

    cells.forEach((text, colOffset) => {
      const fieldId = visibleFieldIds[colStart + colOffset]
      const field = fieldId === undefined ? undefined : fieldsById.get(fieldId)
      if (!field) return
      const parsed = parseCellText(field, text, {
        choices: [...(field.options?.choices ?? []), ...(addedChoices.get(field.id) ?? [])],
        tables
      })
      // null means the text isn't usable here (a word in a number column, an
      // image cell): the cell keeps what it had rather than being emptied.
      if (!parsed) return
      if (parsed.newChoices?.length) {
        addedChoices.set(field.id, [
          ...(addedChoices.get(field.id) ?? []),
          ...parsed.newChoices
        ])
        changed = true
      }
      if (!sameValue(values[field.id], parsed.value)) changed = true
      values[field.id] = parsed.value
    })

    patched.set(recordId, values)
  })

  if (!changed) return table

  const fields =
    addedChoices.size === 0
      ? table.fields
      : table.fields.map((field) => {
          const added = addedChoices.get(field.id)
          if (!added) return field
          return {
            ...field,
            options: { choices: [...(field.options?.choices ?? []), ...added] }
          }
        })

  return {
    ...table,
    fields,
    records: [
      ...table.records.map((record) => {
        const values = patched.get(record.id)
        return values ? { ...record, values } : record
      }),
      ...created.map((record) => ({ ...record, values: patched.get(record.id) ?? record.values }))
    ]
  }
}
