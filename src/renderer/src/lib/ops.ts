import { newRecord, newTable, newView } from '@shared/defaults'
import {
  CREATED_AT_DATE_SOURCE,
  type Field,
  type Project,
  type RecordRow,
  type Table,
  type View,
  type ViewType
} from '@shared/types'

/**
 * Pure transforms of the two things the app edits: a single Table (its
 * records, fields and views), applied through useUpdateTable, and the Project
 * itself (its list of tables), applied through useUpdateProject.
 */

// --- Tables -----------------------------------------------------------------

export function patchTable(project: Project, tableId: string, fn: (table: Table) => Table): Project {
  return { ...project, tables: project.tables.map((t) => (t.id === tableId ? fn(t) : t)) }
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
    const hiddenFieldIds = view.config.hiddenFieldIds.filter((id) => id !== fieldId)
    switch (view.type) {
      case 'table':
        return {
          ...view,
          config: {
            ...view.config,
            hiddenFieldIds,
            filters: view.config.filters.filter((f) => f.fieldId !== fieldId),
            sorts: view.config.sorts.filter((s) => s.fieldId !== fieldId),
            groupByFieldId:
              view.config.groupByFieldId === fieldId ? undefined : view.config.groupByFieldId
          }
        }
      case 'kanban':
        return {
          ...view,
          config: {
            ...view.config,
            hiddenFieldIds,
            groupByFieldId:
              view.config.groupByFieldId === fieldId ? undefined : view.config.groupByFieldId
          }
        }
      case 'gallery':
        return {
          ...view,
          config: {
            ...view.config,
            hiddenFieldIds,
            coverFieldId: view.config.coverFieldId === fieldId ? undefined : view.config.coverFieldId
          }
        }
      case 'calendar':
        return {
          ...view,
          config: {
            ...view.config,
            hiddenFieldIds,
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
