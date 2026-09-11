import { newRecord, newTable, newView } from '@shared/defaults'
import {
  type ChartSpec,
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

/**
 * Stamps `updatedAt` on every record an edit touched, so `lastModifiedTime`
 * fields have something to read.
 *
 * Every transform here is pure, so a record that survived an edit unchanged
 * comes out as the very same object — identity is what tells the two apart,
 * without diffing values. Renaming a view or resizing a column leaves the
 * records array itself untouched and costs a single comparison.
 */
export function touchModifiedRecords(before: Project, after: Project, at: string): Project {
  if (before === after) return after
  const previous = new Map(before.tables.map((table) => [table.id, table]))
  let changed = false
  const tables = after.tables.map((table) => {
    const old = previous.get(table.id)
    // A table the edit added arrives with its records already stamped as new.
    if (!old || old.records === table.records) return table
    const known = new Map(old.records.map((record) => [record.id, record]))
    let touched = false
    const records = table.records.map((record) => {
      const previousRecord = known.get(record.id)
      if (previousRecord === undefined || previousRecord === record) return record
      touched = true
      return { ...record, updatedAt: at }
    })
    if (!touched) return table
    changed = true
    return { ...table, records }
  })
  return changed ? { ...after, tables } : after
}

function replaceTable(project: Project, table: Table): Project {
  return {
    ...project,
    tables: project.tables.map((candidate) => (candidate.id === table.id ? table : candidate))
  }
}

function relationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function setRelationIds(record: RecordRow, fieldId: string, ids: string[]): RecordRow {
  const previous = relationIds(record.values[fieldId])
  if (sameIds(previous, ids) && (ids.length > 0 || !(fieldId in record.values))) return record
  if (ids.length === 0) {
    const { [fieldId]: _removed, ...values } = record.values
    return { ...record, values }
  }
  return { ...record, values: { ...record.values, [fieldId]: ids } }
}

function uniqueFieldName(table: Table, preferred: string): string {
  const taken = new Set(table.fields.map((field) => field.name.toLowerCase()))
  if (!taken.has(preferred.toLowerCase())) return preferred
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred} ${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function relationFieldChanged(before: Table, after: Table, fieldId: string): boolean {
  const previous = before.fields.find((field) => field.id === fieldId)
  const next = after.fields.find((field) => field.id === fieldId)
  if (previous?.type !== 'relation' || next?.type !== 'relation') return previous !== next
  if (
    previous.relation?.tableId !== next.relation?.tableId ||
    previous.relation?.multiple !== next.relation?.multiple ||
    previous.relation?.inverseFieldId !== next.relation?.inverseFieldId
  ) {
    return true
  }
  if (before.records.length !== after.records.length) return true
  const previousRecords = new Map(before.records.map((record) => [record.id, record]))
  return after.records.some((record) => {
    const old = previousRecords.get(record.id)
    return !old || !sameIds(relationIds(old.values[fieldId]), relationIds(record.values[fieldId]))
  })
}

/** Makes one side authoritative, then derives the paired field from it. */
function syncRelationPair(
  project: Project,
  sourceTableId: string,
  sourceFieldId: string,
  beforeSource?: Table
): Project {
  let source = project.tables.find((table) => table.id === sourceTableId)
  let sourceField = source?.fields.find((field) => field.id === sourceFieldId)
  if (!source || sourceField?.type !== 'relation' || !sourceField.relation) return project

  let target = project.tables.find((table) => table.id === sourceField!.relation!.tableId)
  let inverse = target?.fields.find(
    (field) => field.id === sourceField!.relation!.inverseFieldId && field.type === 'relation'
  )
  if (!target || inverse?.type !== 'relation' || !inverse.relation) return project

  const validTargetIds = new Set(target.records.map((record) => record.id))
  const oldLinks = new Map(
    (beforeSource?.records ?? []).map((record) => [record.id, relationIds(record.values[sourceFieldId])])
  )
  const links = new Map<string, string[]>()
  source.records.forEach((record) => {
    const unique = [...new Set(relationIds(record.values[sourceFieldId]))].filter((id) =>
      validTargetIds.has(id)
    )
    links.set(record.id, sourceField!.relation!.multiple ? unique : unique.slice(0, 1))
  })

  // If the reverse side is single-link, a newly made link wins and the old
  // source is disconnected. That keeps both stored fields truthful instead
  // of silently showing two sources on one side and one on the other.
  if (!inverse.relation.multiple) {
    for (const targetRecord of target.records) {
      const candidates = source.records
        .filter((record) => links.get(record.id)?.includes(targetRecord.id))
        .map((record) => record.id)
      if (candidates.length <= 1) continue
      const newlyLinked = candidates.filter(
        (recordId) => !(oldLinks.get(recordId) ?? []).includes(targetRecord.id)
      )
      const winner = newlyLinked.at(-1) ?? candidates[0]
      candidates.forEach((recordId) => {
        if (recordId === winner) return
        links.set(
          recordId,
          (links.get(recordId) ?? []).filter((targetId) => targetId !== targetRecord.id)
        )
      })
    }
  }

  source = {
    ...source,
    records: source.records.map((record) =>
      setRelationIds(record, sourceFieldId, links.get(record.id) ?? [])
    )
  }
  project = replaceTable(project, source)

  // Self-relations may have changed the same table above, so resolve the
  // target again before writing the inverse field.
  target = project.tables.find((table) => table.id === target!.id)!
  const reverse = new Map(target.records.map((record) => [record.id, [] as string[]]))
  source.records.forEach((record) => {
    for (const targetId of links.get(record.id) ?? []) {
      reverse.get(targetId)?.push(record.id)
    }
  })
  target = {
    ...target,
    records: target.records.map((record) =>
      setRelationIds(record, inverse!.id, reverse.get(record.id) ?? [])
    )
  }
  return replaceTable(project, target)
}

function reconcileTableRelations(project: Project, before: Table, tableId: string): Project {
  const initial = project.tables.find((table) => table.id === tableId)
  if (!initial) return project
  let current: Table = initial

  // Removing either half removes the paired field as well. Changing a
  // relation's target creates a fresh pair and retires the old one.
  for (const oldField of before.fields) {
    if (oldField.type !== 'relation' || !oldField.relation?.inverseFieldId) continue
    const nextField = current.fields.find((field) => field.id === oldField.id)
    const keepsPair =
      nextField?.type === 'relation' &&
      nextField.relation?.tableId === oldField.relation.tableId &&
      nextField.relation?.inverseFieldId === oldField.relation.inverseFieldId
    if (keepsPair) continue
    const target = project.tables.find((table) => table.id === oldField.relation!.tableId)
    if (target?.fields.some((field) => field.id === oldField.relation!.inverseFieldId)) {
      project = replaceTable(project, deleteField(target, oldField.relation.inverseFieldId))
    }
  }

  const refreshed = project.tables.find((table) => table.id === tableId)
  if (!refreshed) return project
  current = refreshed

  // Every relation owns a real field in the linked table. Broken or legacy
  // metadata gets a fresh inverse rather than hijacking an unrelated field.
  for (const snapshot of [...current.fields]) {
    if (snapshot.type !== 'relation' || !snapshot.relation) continue
    let field: Field = current.fields.find((candidate) => candidate.id === snapshot.id)!
    if (field.type !== 'relation' || !field.relation) continue
    let target: Table | undefined = project.tables.find(
      (table) => table.id === field.relation!.tableId
    )
    if (!target) continue

    let inverseId = field.relation.inverseFieldId
    if (!inverseId) {
      inverseId = crypto.randomUUID()
      current = {
        ...current,
        fields: current.fields.map((candidate) =>
          candidate.id === field.id
            ? { ...candidate, relation: { ...candidate.relation!, inverseFieldId: inverseId } }
            : candidate
        )
      }
      project = replaceTable(project, current)
      target = project.tables.find((table) => table.id === field.relation!.tableId)!
      field = current.fields.find((candidate) => candidate.id === field.id)!
    }
    let inverse: Field | undefined = target.fields.find((candidate) => candidate.id === inverseId)
    const usableInverse =
      inverse?.type === 'relation' &&
      inverse.relation?.tableId === current.id &&
      (!inverse.relation.inverseFieldId || inverse.relation.inverseFieldId === field.id) &&
      !(target.id === current.id && inverse.id === field.id)
    if (inverse && !usableInverse) {
      inverseId = crypto.randomUUID()
      current = {
        ...current,
        fields: current.fields.map((candidate) =>
          candidate.id === field.id
            ? { ...candidate, relation: { ...candidate.relation!, inverseFieldId: inverseId } }
            : candidate
        )
      }
      project = replaceTable(project, current)
      target = project.tables.find((table) => table.id === field.relation!.tableId)!
      inverse = undefined
      field = current.fields.find((candidate) => candidate.id === field.id)!
    }

    if (!inverse) {
      inverse = {
        id: inverseId,
        name: uniqueFieldName(target, current.name),
        type: 'relation',
        relation: { tableId: current.id, multiple: true, inverseFieldId: field.id }
      }
      target = { ...target, fields: [...target.fields, inverse] }
      project = replaceTable(project, target)
      if (target.id === current.id) current = target
    } else if (inverse.type === 'relation' && inverse.relation) {
      const patched = {
        ...inverse,
        relation: { ...inverse.relation, tableId: current.id, inverseFieldId: field.id }
      }
      target = {
        ...target,
        fields: target.fields.map((candidate) => (candidate.id === inverse!.id ? patched : candidate))
      }
      project = replaceTable(project, target)
      if (target.id === current.id) current = target
    }
  }

  current = project.tables.find((table) => table.id === tableId)!
  const processed = new Set<string>()
  for (const field of current.fields) {
    if (field.type !== 'relation' || !field.relation) continue
    const target = project.tables.find((table) => table.id === field.relation!.tableId)
    const inverse = target?.fields.find(
      (candidate) => candidate.id === field.relation!.inverseFieldId && candidate.type === 'relation'
    )
    if (!target || inverse?.type !== 'relation') continue
    const pairKey = [current.id, field.id, target.id, inverse.id].sort().join(':')
    if (processed.has(pairKey)) continue
    processed.add(pairKey)

    const fieldChanged = relationFieldChanged(before, current, field.id)
    let authorityField = field
    if (target.id === current.id) {
      const inverseChanged = relationFieldChanged(before, current, inverse.id)
      if (!fieldChanged && !inverseChanged) continue
      if (inverseChanged && !fieldChanged) authorityField = inverse
    } else if (!fieldChanged) {
      continue
    }
    project = syncRelationPair(project, current.id, authorityField.id, before)
    current = project.tables.find((table) => table.id === tableId)!
  }
  return project
}

/** Returns the project unchanged when `fn` leaves the table as it was — the
 *  transforms below hand back their input when an edit doesn't apply, and
 *  callers (see useUpdateProject) use identity to tell a real edit apart from
 *  a no-op. */
export function patchTable(project: Project, tableId: string, fn: (table: Table) => Table): Project {
  const before = project.tables.find((table) => table.id === tableId)
  if (!before) return project
  const next = fn(before)
  if (next === before) return project
  return reconcileTableRelations(replaceTable(project, next), before, tableId)
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
 *  original. Self-relation pairs stay inside the copy; relations to another
 *  table get new inverse fields so they don't share the original's pair. */
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
  clone.fields = clone.fields.map((field) => {
    if (field.type !== 'relation' || !field.relation) return field
    return field.relation.tableId === source.id
      ? { ...field, relation: { ...field.relation, tableId: cloneId } }
      : { ...field, relation: { ...field.relation, inverseFieldId: crypto.randomUUID() } }
  })
  const tables = [...project.tables]
  tables.splice(index + 1, 0, clone)
  const inserted = { ...project, tables }
  const emptyBefore: Table = { ...clone, fields: [], records: [] }
  return reconcileTableRelations(inserted, emptyBefore, clone.id)
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
    view.config.dateFieldId = table.fields.find((field) => field.type === 'date')?.id
  }
  // A dashboard with nothing on it says nothing, so it opens on one chart the
  // table can already answer.
  if (view.type === 'dashboard') view.config.charts = [defaultChart(table)]
  if (count > 0) view.name = `${view.name} ${count + 1}`
  return { ...table, views: [...table.views, view] }
}

// --- Dashboard charts -------------------------------------------------------

/** The chart a new dashboard (or a new tile) starts from: records counted by
 *  the first select field, or a plain record count when there's none to group
 *  by — either way something that draws straight away. */
export function defaultChart(table: Table): ChartSpec {
  const groupField = table.fields.find((field) => field.type === 'select')
  return {
    id: crypto.randomUUID(),
    name: '',
    type: groupField ? 'column' : 'metric',
    groupByFieldId: groupField?.id,
    aggregate: 'count'
  }
}

/** Charts live in a dashboard's view config, so every edit to one is a patch of
 *  that view; other view types pass through untouched. */
function patchCharts(
  table: Table,
  viewId: string,
  fn: (charts: ChartSpec[]) => ChartSpec[]
): Table {
  return patchView(table, viewId, (view) =>
    view.type === 'dashboard'
      ? { ...view, config: { ...view.config, charts: fn(view.config.charts) } }
      : view
  )
}

export function addChart(table: Table, viewId: string, chart: ChartSpec): Table {
  return patchCharts(table, viewId, (charts) => [...charts, chart])
}

export function updateChart(table: Table, viewId: string, chart: ChartSpec): Table {
  return patchCharts(table, viewId, (charts) =>
    charts.map((candidate) => (candidate.id === chart.id ? chart : candidate))
  )
}

export function deleteChart(table: Table, viewId: string, chartId: string): Table {
  return patchCharts(table, viewId, (charts) => charts.filter((chart) => chart.id !== chartId))
}

export function duplicateChart(table: Table, viewId: string, chartId: string): Table {
  return patchCharts(table, viewId, (charts) => {
    const index = charts.findIndex((chart) => chart.id === chartId)
    if (index === -1) return charts
    const copy = { ...charts[index], id: crypto.randomUUID() }
    return [...charts.slice(0, index + 1), copy, ...charts.slice(index + 1)]
  })
}

/** Moves a chart one place along the grid; a move off either end is a no-op. */
export function moveChart(table: Table, viewId: string, chartId: string, offset: number): Table {
  return patchCharts(table, viewId, (charts) => {
    const index = charts.findIndex((chart) => chart.id === chartId)
    const target = index + offset
    if (index === -1 || target < 0 || target >= charts.length) return charts
    const next = [...charts]
    next.splice(target, 0, ...next.splice(index, 1))
    return next
  })
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

/** Moves `fieldId` to where `targetFieldId` sits, sliding the fields in
 *  between over to make room. Field order belongs to the table rather than to
 *  a view, so the column moves everywhere the field shows. */
export function moveField(table: Table, fieldId: string, targetFieldId: string): Table {
  const from = table.fields.findIndex((f) => f.id === fieldId)
  const to = table.fields.findIndex((f) => f.id === targetFieldId)
  if (from === -1 || to === -1 || from === to) return table
  const fields = [...table.fields]
  const [moved] = fields.splice(from, 1)
  // `to` was read before the removal, which is what puts the field past the
  // target when moving right and before it when moving left.
  fields.splice(to, 0, moved)
  return { ...table, fields }
}

export function updateField(table: Table, fieldId: string, patch: Partial<Field>): Table {
  return {
    ...table,
    fields: table.fields.map((f) => (f.id === fieldId ? { ...f, ...patch, id: f.id } : f))
  }
}
function withoutKey<T>(
  values: Record<string, T> | undefined,
  key: string
): Record<string, T> | undefined {
  if (!values || !(key in values)) return values
  const { [key]: _removed, ...rest } = values
  return rest
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
              view.config.groupByFieldId === fieldId ? undefined : view.config.groupByFieldId,
            columnWidths: withoutKey(view.config.columnWidths, fieldId),
            summaries: withoutKey(view.config.summaries, fieldId),
            audioPlayback: withoutKey(view.config.audioPlayback, fieldId)
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
      // A chart that was reading the deleted field keeps its place and falls
      // back to its "pick a field" prompt, rather than vanishing with it.
      case 'dashboard':
        return {
          ...view,
          config: {
            ...view.config,
            ...shared,
            charts: view.config.charts.map((chart) => ({
              ...chart,
              filters: chart.filters?.filter((rule) => rule.fieldId !== fieldId),
              groupByFieldId: chart.groupByFieldId === fieldId ? undefined : chart.groupByFieldId,
              valueFieldId: chart.valueFieldId === fieldId ? undefined : chart.valueFieldId
            }))
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
