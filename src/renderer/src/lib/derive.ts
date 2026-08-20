import type { Field, FilterRule, RecordRow, SelectChoice, SortRule, Table } from '@shared/types'
import { choiceById, displayValue, isEmptyValue, linkedRecordIds, operatorsFor } from './fields'

function fieldMap(fields: Field[]): Map<string, Field> {
  return new Map(fields.map((f) => [f.id, f]))
}

function matchesRule(record: RecordRow, rule: FilterRule, field: Field): boolean {
  const value = record.values[field.id]
  const empty = isEmptyValue(field, value)

  switch (rule.operator) {
    case 'isEmpty':
      return empty
    case 'isNotEmpty':
      return !empty
  }

  if (field.type === 'checkbox') {
    return rule.operator === 'is' ? value === true : value !== true
  }

  // Remaining operators need a comparison value; an unset rule matches everything.
  const target = rule.value
  if (target === undefined || target === null || target === '') return true

  switch (field.type) {
    case 'select': {
      const match = value === target
      return rule.operator === 'is' ? match : !match
    }
    case 'multiSelect': {
      const has = Array.isArray(value) && value.includes(target)
      return rule.operator === 'contains' ? has : !has
    }
    // Matched by linked record id, so filtering never has to look into the
    // other table.
    case 'relation': {
      const has = linkedRecordIds(value).includes(String(target))
      return rule.operator === 'contains' ? has : !has
    }
    case 'number': {
      if (typeof value !== 'number') return false
      const num = Number(target)
      if (Number.isNaN(num)) return true
      switch (rule.operator) {
        case 'is':
          return value === num
        case 'isNot':
          return value !== num
        case 'gt':
          return value > num
        case 'lt':
          return value < num
        default:
          return true
      }
    }
    case 'date': {
      if (typeof value !== 'string' || empty) return false
      const target_ = String(target)
      switch (rule.operator) {
        case 'is':
          return value === target_
        case 'gt':
          return value > target_
        case 'lt':
          return value < target_
        default:
          return true
      }
    }
    default: {
      const text = displayValue(field, value).toLowerCase()
      const needle = String(target).toLowerCase()
      switch (rule.operator) {
        case 'contains':
          return text.includes(needle)
        case 'notContains':
          return !text.includes(needle)
        case 'is':
          return text === needle
        case 'isNot':
          return text !== needle
        default:
          return true
      }
    }
  }
}

export function applyFilters(records: RecordRow[], filters: FilterRule[], fields: Field[]): RecordRow[] {
  if (filters.length === 0) return records
  const byId = fieldMap(fields)
  const valid = filters.filter((rule) => {
    const field = byId.get(rule.fieldId)
    return field !== undefined && operatorsFor(field).some((op) => op.value === rule.operator)
  })
  if (valid.length === 0) return records
  return records.filter((record) =>
    valid.every((rule) => matchesRule(record, rule, byId.get(rule.fieldId)!))
  )
}

function compareValues(a: RecordRow, b: RecordRow, field: Field, tables: Table[]): number {
  const va = a.values[field.id]
  const vb = b.values[field.id]
  const emptyA = isEmptyValue(field, va)
  const emptyB = isEmptyValue(field, vb)
  if (emptyA && emptyB) return 0
  if (emptyA) return 1 // empties always sink to the bottom
  if (emptyB) return -1

  switch (field.type) {
    case 'number':
      return (va as number) - (vb as number)
    case 'checkbox':
      return (va === true ? 0 : 1) - (vb === true ? 0 : 1)
    case 'date':
      return String(va).localeCompare(String(vb))
    case 'select': {
      const choices = field.options?.choices ?? []
      const ia = choices.findIndex((c) => c.id === va)
      const ib = choices.findIndex((c) => c.id === vb)
      return ia - ib
    }
    default:
      return displayValue(field, va, tables).localeCompare(displayValue(field, vb, tables))
  }
}

/** `tables` is only read to sort/group by a relation field, whose text lives
 *  in another table; omitting it just makes those rows compare as equal. */
export function applySorts(
  records: RecordRow[],
  sorts: SortRule[],
  fields: Field[],
  tables: Table[] = []
): RecordRow[] {
  if (sorts.length === 0) return records
  const byId = fieldMap(fields)
  const valid = sorts.filter((s) => byId.has(s.fieldId))
  if (valid.length === 0) return records
  return [...records].sort((a, b) => {
    for (const sort of valid) {
      const field = byId.get(sort.fieldId)!
      const cmp = compareValues(a, b, field, tables)
      if (cmp !== 0) return sort.direction === 'asc' ? cmp : -cmp
    }
    return 0
  })
}

export interface RecordGroup {
  key: string
  label: string
  choice?: SelectChoice
  records: RecordRow[]
}

export const UNCATEGORIZED = '__uncategorized__'

/**
 * Buckets records by a field. Select fields produce one group per choice (in
 * choice order, kept even when empty — kanban wants stable columns) plus an
 * "Uncategorized" bucket. Other types bucket by display value.
 */
export function groupRecords(
  records: RecordRow[],
  field: Field,
  tables: Table[] = []
): RecordGroup[] {
  if (field.type === 'select') {
    const choices = field.options?.choices ?? []
    const groups: RecordGroup[] = choices.map((choice) => ({
      key: choice.id,
      label: choice.name,
      choice,
      records: []
    }))
    const uncategorized: RecordGroup = { key: UNCATEGORIZED, label: 'Uncategorized', records: [] }
    for (const record of records) {
      const choice = choiceById(field, record.values[field.id])
      if (choice) groups.find((g) => g.key === choice.id)!.records.push(record)
      else uncategorized.records.push(record)
    }
    return [...groups, uncategorized]
  }

  if (field.type === 'checkbox') {
    const checked: RecordGroup = { key: 'checked', label: 'Checked', records: [] }
    const unchecked: RecordGroup = { key: 'unchecked', label: 'Unchecked', records: [] }
    for (const record of records) {
      ;(record.values[field.id] === true ? checked : unchecked).records.push(record)
    }
    return [checked, unchecked]
  }

  const buckets = new Map<string, RecordGroup>()
  const empty: RecordGroup = { key: UNCATEGORIZED, label: 'Empty', records: [] }
  for (const record of records) {
    const text = displayValue(field, record.values[field.id], tables)
    if (text === '') {
      empty.records.push(record)
      continue
    }
    let group = buckets.get(text)
    if (!group) {
      group = { key: text, label: text, records: [] }
      buckets.set(text, group)
    }
    group.records.push(record)
  }
  const sorted = [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label))
  return empty.records.length > 0 ? [...sorted, empty] : sorted
}
