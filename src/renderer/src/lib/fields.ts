import { format as formatDate } from 'date-fns'
import {
  AlignLeft,
  AudioLines,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleChevronDown,
  Hash,
  Image as ImageIcon,
  Link2,
  Paperclip,
  SquareCheck,
  Star,
  Tags,
  Video,
  Waypoints,
  type LucideIcon
} from 'lucide-react'
import type {
  AttachmentValue,
  ChoiceColor,
  DateFormat,
  Field,
  FieldType,
  FilterOperator,
  RecordRow,
  SelectChoice,
  Table,
  VideoValue
} from '@shared/types'

export interface FieldTypeInfo {
  type: FieldType
  label: string
  icon: LucideIcon
}

export const FIELD_TYPES: FieldTypeInfo[] = [
  { type: 'text', label: 'Text', icon: AlignLeft },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'rating', label: 'Rating', icon: Star },
  { type: 'select', label: 'Single select', icon: CircleChevronDown },
  { type: 'multiSelect', label: 'Multi select', icon: Tags },
  { type: 'date', label: 'Date', icon: CalendarDays },
  { type: 'checkbox', label: 'Checkbox', icon: SquareCheck },
  { type: 'url', label: 'URL', icon: Link2 },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'audio', label: 'Audio', icon: AudioLines },
  { type: 'video', label: 'Video', icon: Video },
  { type: 'attachment', label: 'Attachment', icon: Paperclip },
  { type: 'relation', label: 'Link to records', icon: Waypoints },
  { type: 'createdTime', label: 'Created time', icon: CalendarPlus },
  { type: 'lastModifiedTime', label: 'Last modified time', icon: CalendarClock }
]

/** Fields the app fills in from the record itself. They have no stored value,
 *  so nothing may edit, paste or import into them. */
export function isComputedField(type: FieldType): boolean {
  return type === 'createdTime' || type === 'lastModifiedTime'
}

/** The value a field reads for a record. Every type but the computed ones
 *  stores it in `values`; those two derive it from the record's timestamps. */
export function cellValue(field: Field, record: RecordRow): unknown {
  switch (field.type) {
    case 'createdTime':
      return record.createdAt
    case 'lastModifiedTime':
      // Records written before the app tracked modification read as untouched
      // since they were created, which is the truthful answer for them.
      return record.updatedAt ?? record.createdAt
    default:
      return record.values[field.id]
  }
}

/** Fixed 5-star scale for `rating` fields. */
export const RATING_MAX = 5

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
  // Image/audio fields display as internal file paths (e.g. app-image:///...),
  // and video/attachment as a raw object or array, none meaningful as a
  // record label.
  const showable =
    primary &&
    primary.type !== 'image' &&
    primary.type !== 'audio' &&
    primary.type !== 'video' &&
    primary.type !== 'attachment'
  const text = showable ? displayValue(primary, cellValue(primary, record)) : ''
  return text || 'Untitled'
}

/** A `video` cell's value, or undefined when the cell holds anything that
 *  isn't shaped like one. */
export function videoFrom(value: unknown): VideoValue | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const video = value as VideoValue
  return typeof video.url === 'string' && video.url !== '' ? video : undefined
}

/** What a video cell shows for itself when there's no poster to show. */
export function videoLabel(video: VideoValue): string {
  return video.name ?? 'Video'
}

/** Whether a view can feature this field as a card cover: an image, or a
 *  video by way of the frame captured from it. */
export function isCoverField(field: Field): boolean {
  return field.type === 'image' || field.type === 'video'
}

/** The image url a field contributes when a view features it as a cover or
 *  thumbnail. An `image` cell is the url itself; a `video` cell is the frame
 *  captured from it, which is why a video field can be picked as a cover at
 *  all. Anything else — or a video with no poster yet — has none. */
export function coverImageUrl(field: Field, value: unknown): string | undefined {
  if (field.type === 'video') return videoFrom(value)?.poster
  if (field.type !== 'image') return undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** An `attachment` cell's well-formed files, filtering out anything that
 *  doesn't have the shape a real attachment value would. */
export function attachmentsFrom(value: unknown): AttachmentValue[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is AttachmentValue =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as AttachmentValue).url === 'string' &&
      typeof (v as AttachmentValue).name === 'string'
  )
}

/** Human-readable file size, e.g. `1.4 MB`. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function isEmptyValue(field: Field, value: unknown): boolean {
  if (value === null || value === undefined) return true
  switch (field.type) {
    case 'checkbox':
      return value !== true
    case 'multiSelect':
    case 'relation':
    case 'attachment':
      return !Array.isArray(value) || value.length === 0
    case 'select':
      return choiceById(field, value) === undefined
    case 'video':
      return videoFrom(value) === undefined
    case 'number':
    case 'rating':
      return typeof value !== 'number'
    default:
      return typeof value !== 'string' || value.trim() === ''
  }
}

/** A date field stores either an all-day local date or a local wall-clock time.
 *  Keeping both forms ISO-shaped preserves chronological string sorting and
 *  avoids silently moving an event when the computer's time zone changes. */
export const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/

export function dateValueParts(value: unknown): { date: string; time?: string } | undefined {
  if (typeof value !== 'string' || !DATE_VALUE_PATTERN.test(value)) return undefined
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined
  }
  if (value.length === 10) return { date: value }
  const time = value.slice(11)
  const [hour, minute] = time.split(':').map(Number)
  if (hour > 23 || minute > 59) return undefined
  return { date: value.slice(0, 10), time }
}

/** The local calendar day and wall-clock time an absolute instant falls on,
 *  in the same shape `dateValueParts` returns for a stored `date` value. */
export function timestampParts(value: unknown): { date: string; time: string } | undefined {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(NaN)
  if (Number.isNaN(date.getTime())) return undefined
  return { date: formatDate(date, 'yyyy-MM-dd'), time: formatDate(date, 'HH:mm') }
}

/** Date parts for any field that puts records on a calendar or takes a date
 *  filter, whichever way it stores them. */
export function fieldDateParts(
  field: Field,
  value: unknown
): { date: string; time?: string } | undefined {
  return isComputedField(field.type) ? timestampParts(value) : dateValueParts(value)
}

export interface DateFormatInfo {
  value: DateFormat
  /** date-fns pattern for the date, and the time when the format shows one. */
  pattern: string
  /** Whether the format shows a wall-clock time as well as the date. Callers
   *  that render the time on its own — a calendar's event chip — read this to
   *  know whether the field is meant to show one at all. */
  hasTime: boolean
  /** Whether to append the computer's current UTC offset, e.g. ` (GMT+8)`. */
  zoned: boolean
}

/** Timestamp formats a `createdTime`/`lastModifiedTime` field can render in.
 *  The first is the default for a field that hasn't picked one. */
export const DATE_FORMATS: DateFormatInfo[] = [
  { value: 'slash', pattern: 'yyyy/MM/dd', hasTime: false, zoned: false },
  { value: 'slashTime', pattern: 'yyyy/MM/dd HH:mm', hasTime: true, zoned: false },
  { value: 'slashTimeZone', pattern: 'yyyy/MM/dd HH:mm', hasTime: true, zoned: true },
  { value: 'dash', pattern: 'yyyy-MM-dd', hasTime: false, zoned: false },
  { value: 'dashTime', pattern: 'yyyy-MM-dd HH:mm', hasTime: true, zoned: false },
  { value: 'dashTimeZone', pattern: 'yyyy-MM-dd HH:mm', hasTime: true, zoned: true }
]

export function dateFormatInfo(format: DateFormat | undefined): DateFormatInfo {
  return DATE_FORMATS.find((f) => f.value === format) ?? DATE_FORMATS[0]
}

/** The computer's offset from UTC at `date`, as `GMT+8` / `GMT-5:30`. Read at
 *  the instant being shown so a timestamp from the other side of a DST switch
 *  is labelled with the offset it is actually being rendered in. */
function gmtOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset()
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `GMT${minutes < 0 ? '-' : '+'}${hours}${rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`}`
}

/** Renders a full ISO instant — a record's created/modified stamp — in local
 *  time. Unlike a `date` cell these are absolute moments, so they move with
 *  the computer's time zone rather than staying put. */
export function formatTimestamp(value: unknown, format?: DateFormat): string {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(NaN)
  if (Number.isNaN(date.getTime())) return ''
  const info = dateFormatInfo(format)
  const text = formatDate(date, info.pattern)
  return info.zoned ? `${text} (${gmtOffset(date)})` : text
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
    case 'rating':
      return String(value)
    case 'attachment':
      return attachmentsFrom(value)
        .map((a) => a.name)
        .join(', ')
    case 'video': {
      const video = videoFrom(value)
      return video ? (video.name ?? video.url) : ''
    }
    case 'createdTime':
    case 'lastModifiedTime':
      return formatTimestamp(value, field.dateFormat)
    case 'date': {
      const parts = dateValueParts(value)
      if (!parts) return String(value)
      const date = new Date(`${parts.date}T${parts.time ?? '00:00'}:00`)
      return parts.time
        ? date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          })
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
    case 'rating':
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
    case 'createdTime':
    case 'lastModifiedTime':
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
    case 'video':
    case 'attachment':
      return isEmptyOps
  }
}
