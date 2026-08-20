import {
  AlignLeft,
  AudioLines,
  CalendarDays,
  CircleChevronDown,
  Hash,
  Image as ImageIcon,
  Link2,
  SquareCheck,
  Tags,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type {
  ChoiceColor,
  Field,
  FieldType,
  FilterOperator,
  RecordRow,
  SelectChoice,
  Table
} from '@shared/types'

export interface FieldTypeInfo {
  type: FieldType
  label: string
  icon: LucideIcon
}

export const FIELD_TYPES: FieldTypeInfo[] = [
  { type: 'text', label: 'Text', icon: AlignLeft },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'select', label: 'Single select', icon: CircleChevronDown },
  { type: 'multiSelect', label: 'Multi select', icon: Tags },
  { type: 'date', label: 'Date', icon: CalendarDays },
  { type: 'checkbox', label: 'Checkbox', icon: SquareCheck },
  { type: 'url', label: 'URL', icon: Link2 },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'audio', label: 'Audio', icon: AudioLines },
  { type: 'relation', label: 'Link to records', icon: Waypoints }
]

export function fieldTypeInfo(type: FieldType): FieldTypeInfo {
  return FIELD_TYPES.find((t) => t.type === type) ?? FIELD_TYPES[0]
}

export const CHOICE_COLOR_ORDER: ChoiceColor[] = [
  'gray',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink'
]

/** Badge-style classes for select choices. */
export const CHOICE_BADGE_CLASSES: Record<ChoiceColor, string> = {
  gray: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-300'
}

/** Solid dot classes for compact color swatches. */
export const CHOICE_DOT_CLASSES: Record<ChoiceColor, string> = {
  gray: 'bg-neutral-400',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500'
}

export function nextChoiceColor(existing: SelectChoice[]): ChoiceColor {
  return CHOICE_COLOR_ORDER[existing.length % CHOICE_COLOR_ORDER.length]
}

export function choiceById(field: Field, id: unknown): SelectChoice | undefined {
  if (typeof id !== 'string') return undefined
  return field.options?.choices.find((c) => c.id === id)
}

export function choicesByIds(field: Field, ids: unknown): SelectChoice[] {
  if (!Array.isArray(ids)) return []
  return ids
    .map((id) => choiceById(field, id))
    .filter((c): c is SelectChoice => c !== undefined)
}

/** The table a relation field links into, if it's still around. */
export function relationTable(field: Field, tables: Table[]): Table | undefined {
  if (field.type !== 'relation' || !field.relation) return undefined
  return tables.find((t) => t.id === field.relation!.tableId)
}

/** A relation cell always stores an array of record ids — one entry at most
 *  when the field isn't `multiple` — so toggling that setting never
 *  invalidates what's already stored. */
export function linkedRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

/** Linked records in link order. Ids whose record is gone (deleted in the
 *  other table) simply drop out, the way an unknown choice id does. */
export function linkedRecords(field: Field, value: unknown, tables: Table[]): RecordRow[] {
  const target = relationTable(field, tables)
  if (!target) return []
  return linkedRecordIds(value)
    .map((id) => target.records.find((r) => r.id === id))
    .filter((r): r is RecordRow => r !== undefined)
}

/** How a record reads when linked from another table: its first field's text.
 *  That field can itself be a relation, which is why this doesn't resolve
 *  links — one level is enough to name a row, and it can't recurse. */
export function recordLabel(table: Table, record: RecordRow): string {
  const primary = table.fields[0]
  const text = primary ? displayValue(primary, record.values[primary.id]) : ''
  return text || 'Untitled'
}

export function isEmptyValue(field: Field, value: unknown): boolean {
  if (value === null || value === undefined) return true
  switch (field.type) {
    case 'checkbox':
      return value !== true
    case 'multiSelect':
    case 'relation':
      return !Array.isArray(value) || value.length === 0
    case 'select':
      return choiceById(field, value) === undefined
    case 'number':
      return typeof value !== 'number'
    default:
      return typeof value !== 'string' || value.trim() === ''
  }
}

/** Plain-text rendering of a value, used for search, sorting and fallbacks.
 *  `tables` only matters for relation fields, whose text lives in another
 *  table; callers without a project in reach can leave it off and get ''. */
export function displayValue(field: Field, value: unknown, tables: Table[] = []): string {
  if (isEmptyValue(field, value)) return ''
  switch (field.type) {
    case 'select':
      return choiceById(field, value)?.name ?? ''
    case 'multiSelect':
      return choicesByIds(field, value)
        .map((c) => c.name)
        .join(', ')
    case 'relation': {
      const target = relationTable(field, tables)
      if (!target) return ''
      return linkedRecords(field, value, tables)
        .map((record) => recordLabel(target, record))
        .join(', ')
    }
    case 'checkbox':
      return value === true ? 'Checked' : ''
    case 'number':
      return String(value)
    case 'date': {
      const date = new Date(`${String(value)}T00:00:00`)
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    }
    default:
      return String(value)
  }
}

export interface OperatorInfo {
  value: FilterOperator
  label: string
  needsValue: boolean
}

export function operatorsFor(field: Field): OperatorInfo[] {
  const isEmptyOps: OperatorInfo[] = [
    { value: 'isEmpty', label: 'is empty', needsValue: false },
    { value: 'isNotEmpty', label: 'is not empty', needsValue: false }
  ]
  switch (field.type) {
    case 'text':
    case 'url':
      return [
        { value: 'contains', label: 'contains', needsValue: true },
        { value: 'notContains', label: 'does not contain', needsValue: true },
        { value: 'is', label: 'is', needsValue: true },
        { value: 'isNot', label: 'is not', needsValue: true },
        ...isEmptyOps
      ]
    case 'number':
      return [
        { value: 'is', label: '=', needsValue: true },
        { value: 'isNot', label: '≠', needsValue: true },
        { value: 'gt', label: '>', needsValue: true },
        { value: 'lt', label: '<', needsValue: true },
        ...isEmptyOps
      ]
    case 'select':
      return [
        { value: 'is', label: 'is', needsValue: true },
        { value: 'isNot', label: 'is not', needsValue: true },
        ...isEmptyOps
      ]
    case 'multiSelect':
      return [
        { value: 'contains', label: 'has', needsValue: true },
        { value: 'notContains', label: 'does not have', needsValue: true },
        ...isEmptyOps
      ]
    case 'date':
      return [
        { value: 'is', label: 'is', needsValue: true },
        { value: 'gt', label: 'is after', needsValue: true },
        { value: 'lt', label: 'is before', needsValue: true },
        ...isEmptyOps
      ]
    case 'checkbox':
      return [
        { value: 'is', label: 'is checked', needsValue: false },
        { value: 'isNot', label: 'is unchecked', needsValue: false }
      ]
    case 'relation':
      return [
        { value: 'contains', label: 'links to', needsValue: true },
        { value: 'notContains', label: 'does not link to', needsValue: true },
        ...isEmptyOps
      ]
    case 'image':
    case 'audio':
      return isEmptyOps
  }
}
