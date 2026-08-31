import type { Field, SelectChoice, Table } from '@shared/types'
import {
  attachmentsFrom,
  choiceById,
  choicesByIds,
  dateValueParts,
  formatTimestamp,
  isComputedField,
  linkedRecords,
  nextChoiceColor,
  RATING_MAX,
  recordLabel,
  relationTable
} from './fields'

/**
 * Round-trippable text for a cell value, and the parse back the other way.
 *
 * This is deliberately not `displayValue` from fields.ts: that one renders for
 * the screen (localized dates, "Checked" for a tick), while a spreadsheet wants
 * the underlying value back — an ISO date, a plain `true` — so that copying a
 * column out and pasting it in again is a no-op. Both CSV and the clipboard go
 * through here, so the two stay in step by construction.
 */

/** Separator between the parts of a multi-value cell (multi select, relation). */
const LIST_SEPARATOR = ', '

export function cellToText(field: Field, value: unknown, tables: Table[] = []): string {
  if (value === null || value === undefined) return ''
  switch (field.type) {
    case 'checkbox':
      return value === true ? 'true' : 'false'
    case 'number':
    case 'rating':
      return typeof value === 'number' ? String(value) : ''
    case 'select':
      return choiceById(field, value)?.name ?? ''
    case 'multiSelect':
      return choicesByIds(field, value)
        .map((c) => c.name)
        .join(LIST_SEPARATOR)
    case 'relation': {
      const target = relationTable(field, tables)
      if (!target) return ''
      return linkedRecords(field, value, tables)
        .map((record) => recordLabel(target, record))
        .join(LIST_SEPARATOR)
    }
    case 'attachment':
      return attachmentsFrom(value)
        .map((a) => a.name)
        .join(LIST_SEPARATOR)
    // Nothing can paste or import a created/modified stamp back in, so there's
    // no raw form worth preserving — export the text the column shows.
    case 'createdTime':
    case 'lastModifiedTime':
      return formatTimestamp(value, field.dateFormat)
    // Dates are stored as `yyyy-MM-dd` / `yyyy-MM-ddTHH:mm` already, and image/audio as the url
    // they resolve through, so both are their own text form.
    default:
      return String(value)
  }
}

const pad = (part: string): string => part.padStart(2, '0')

/** `yyyy-MM-dd` / `yyyy/M/d`, optionally with a time. These unambiguous forms are matched textually so a
 *  timezone west of UTC can't roll them back a day. */
const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?$/

/** What a numeric date looks like in a spreadsheet export, in any order. */
const NUMERIC_DATE = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}(?:[T\s].*)?$/

function parseDate(text: string): string | undefined {
  const iso = ISO_DATE.exec(text)
  if (iso) {
    const date = `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`
    if (!iso[4]) return dateValueParts(date) ? date : undefined
    const hour = Number(iso[4])
    const minute = Number(iso[5])
    const value = `${date}T${pad(iso[4])}:${iso[5]}`
    return hour < 24 && minute < 60 && dateValueParts(value) ? value : undefined
  }
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return undefined
  const date = `${parsed.getFullYear()}-${pad(String(parsed.getMonth() + 1))}-${pad(String(parsed.getDate()))}`
  const hasTime = /\d:\d|\b(?:am|pm)\b/i.test(text)
  return hasTime
    ? `${date}T${pad(String(parsed.getHours()))}:${pad(String(parsed.getMinutes()))}`
    : date
}

function parseNumber(text: string): number | undefined {
  // A leading currency symbol and accounting's parenthesised negatives are
  // both common in exported spreadsheets and both mean a plain number.
  let source = text.replace(/^[$€£¥]\s?/, '')
  const parenthesised = /^\((.*)\)$/.exec(source)
  if (parenthesised) source = `-${parenthesised[1]}`
  // Only strip commas that are actually grouping digits — in much of the world
  // `1,5` is one and a half, and turning it into fifteen would be worse than
  // refusing it.
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(source)) source = source.replaceAll(',', '')
  if (source.trim() === '') return undefined
  const value = Number(source)
  return Number.isFinite(value) ? value : undefined
}

const TRUTHY = new Set(['true', 'yes', 'y', '1', 'x', '✓', 'checked', 'on'])
const FALSY = new Set(['false', 'no', 'n', '0', '', 'unchecked', 'off'])

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export interface ParsedCell {
  value: unknown
  /** Choices the text named that the field doesn't have yet, in the order they
   *  were first seen. The caller appends them to the field. */
  newChoices?: SelectChoice[]
}

export interface ParseContext {
  /** The field's choices *including* any added earlier in the same paste, so a
   *  value repeated down a column only creates one choice. */
  choices: SelectChoice[]
  /** Only relation fields need these, to resolve labels into record ids. */
  tables: Table[]
}

/**
 * Reads pasted/imported text as a value for `field`.
 *
 * Returns null for "this cell can't take that", which callers treat as leave
 * it alone — pasting a block of text across an image column shouldn't wipe the
 * images. Empty text always clears, since that's how a spreadsheet says empty.
 */
export function parseCellText(field: Field, raw: string, ctx: ParseContext): ParsedCell | null {
  const text = raw.trim()

  // Created/modified stamps come from the record itself. Refusing them here is
  // what keeps a paste or CSV import from writing over one.
  if (isComputedField(field.type)) return null

  // Checkbox is the one type with no empty state: a blank cell is unchecked.
  if (field.type === 'checkbox') return { value: TRUTHY.has(text.toLowerCase()) }
  if (text === '') return { value: undefined }

  switch (field.type) {
    case 'text':
      // Kept untrimmed: a text cell is the one place surrounding whitespace
      // could be meaningful, and quoting preserved it through the parse.
      return { value: raw }
    case 'url':
      return { value: text }
    case 'number': {
      const value = parseNumber(text)
      return value === undefined ? null : { value }
    }
    case 'rating': {
      const value = parseNumber(text)
      if (value === undefined || !Number.isInteger(value) || value < 1 || value > RATING_MAX) {
        return null
      }
      return { value }
    }
    case 'date': {
      const value = parseDate(text)
      return value === undefined ? null : { value }
    }
    case 'select': {
      const existing = ctx.choices.find((c) => c.name.toLowerCase() === text.toLowerCase())
      if (existing) return { value: existing.id }
      const choice: SelectChoice = {
        id: crypto.randomUUID(),
        name: text,
        color: nextChoiceColor(ctx.choices)
      }
      return { value: choice.id, newChoices: [choice] }
    }
    case 'multiSelect': {
      const ids: string[] = []
      const newChoices: SelectChoice[] = []
      for (const name of splitList(text)) {
        const pool = [...ctx.choices, ...newChoices]
        const existing = pool.find((c) => c.name.toLowerCase() === name.toLowerCase())
        if (existing) {
          if (!ids.includes(existing.id)) ids.push(existing.id)
          continue
        }
        const choice: SelectChoice = {
          id: crypto.randomUUID(),
          name,
          color: nextChoiceColor(pool)
        }
        newChoices.push(choice)
        ids.push(choice.id)
      }
      return { value: ids, newChoices }
    }
    case 'relation': {
      const target = relationTable(field, ctx.tables)
      if (!target) return null
      const ids: string[] = []
      for (const label of splitList(text)) {
        const match = target.records.find(
          (record) => recordLabel(target, record).toLowerCase() === label.toLowerCase()
        )
        // Links are only ever made to records that already exist; a label that
        // matches nothing is skipped rather than inventing a row in the other
        // table.
        if (match && !ids.includes(match.id)) ids.push(match.id)
      }
      if (ids.length === 0) return null
      return { value: field.relation?.multiple ? ids : ids.slice(0, 1) }
    }
    case 'image':
    case 'audio':
      // Only a url means anything here; free text would just break the cell.
      return /^(https?|app-image|app-audio):/i.test(text) ? { value: text } : null
    case 'attachment':
      // Files come from the picker or a drop, which carry real bytes; typed
      // text can't produce that, so pasting into this column is a no-op.
      return null
    case 'createdTime':
    case 'lastModifiedTime':
      return null
  }
}

/**
 * Picks the field type for a CSV column from the values in it. Every sample
 * has to agree, so one stray word keeps a column as text rather than making
 * most of its rows import as empty.
 *
 * Order matters: `1` reads as a number before it reads as a checkbox's "on",
 * and a bare number must not be taken for a year.
 */
export function inferFieldType(samples: string[]): Field['type'] {
  const values = samples.map((s) => s.trim()).filter((s) => s !== '')
  if (values.length === 0) return 'text'

  const every = (test: (value: string) => boolean): boolean => values.every(test)

  if (every((v) => TRUTHY.has(v.toLowerCase()) || FALSY.has(v.toLowerCase()))) {
    // All-numeric columns satisfy this via `1`/`0`; they're numbers.
    if (!every((v) => parseNumber(v) !== undefined)) return 'checkbox'
  }
  if (every((v) => parseNumber(v) !== undefined)) return 'number'
  if (every((v) => NUMERIC_DATE.test(v) && parseDate(v) !== undefined)) return 'date'
  if (every((v) => /^https?:\/\/\S+$/i.test(v))) return 'url'
  return 'text'
}
