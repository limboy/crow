import type { Field, RecordRow, SummaryKey, Table } from '@shared/types'
import { displayValue, isEmptyValue } from './fields'

export interface SummaryOption {
  key: SummaryKey
  /** Shown in the picker menu. */
  label: string
  /** Shown next to the value in the bottom bar, where space is tight. */
  short: string
}

/** Counting summaries, which mean the same thing for every field type. */
const BASIC_SUMMARIES: SummaryOption[] = [
  { key: 'none', label: 'None', short: '' },
  { key: 'empty', label: 'Empty', short: 'Empty' },
  { key: 'filled', label: 'Filled', short: 'Filled' },
  { key: 'unique', label: 'Unique', short: 'Unique' },
  { key: 'percentEmpty', label: 'Percent Empty', short: 'Empty' },
  { key: 'percentFilled', label: 'Percent Filled', short: 'Filled' },
  { key: 'percentUnique', label: 'Percent Unique', short: 'Unique' }
]

const NUMBER_SUMMARIES: SummaryOption[] = [
  { key: 'sum', label: 'Sum', short: 'Sum' },
  { key: 'average', label: 'Average', short: 'Avg' },
  { key: 'median', label: 'Median', short: 'Median' },
  { key: 'min', label: 'Min', short: 'Min' },
  { key: 'max', label: 'Max', short: 'Max' },
  { key: 'range', label: 'Range', short: 'Range' }
]

const DATE_SUMMARIES: SummaryOption[] = [
  { key: 'earliest', label: 'Earliest Date', short: 'Earliest' },
  { key: 'latest', label: 'Latest Date', short: 'Latest' },
  { key: 'dateRange', label: 'Date Range', short: 'Range' }
]

/** Summaries a column can show: the counting ones every field has, plus the
 *  arithmetic/chronological ones that only make sense for its type. */
export function summaryOptions(field: Field): SummaryOption[] {
  switch (field.type) {
    case 'number':
    case 'rating':
      return [...BASIC_SUMMARIES, ...NUMBER_SUMMARIES]
    case 'date':
      return [...BASIC_SUMMARIES, ...DATE_SUMMARIES]
    default:
      return BASIC_SUMMARIES
  }
}

export function summaryOption(field: Field, key: SummaryKey | undefined): SummaryOption | undefined {
  if (!key || key === 'none') return undefined
  return summaryOptions(field).find((o) => o.key === key)
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatPercent(part: number, total: number): string {
  if (total === 0) return '—'
  return `${((part / total) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

function numberValues(field: Field, records: RecordRow[]): number[] {
  return records
    .map((r) => r.values[field.id])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

/** Date cells use ISO local date/date-time strings, so plain string order is chronological order. */
function dateValues(field: Field, records: RecordRow[]): string[] {
  return records
    .map((r) => r.values[field.id])
    .filter((v): v is string => typeof v === 'string' && !isEmptyValue(field, v))
    .sort()
}

function daysBetween(from: string, to: string): number | undefined {
  const start = new Date(`${from.slice(0, 10)}T00:00:00`).getTime()
  const end = new Date(`${to.slice(0, 10)}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined
  return Math.round((end - start) / 86_400_000)
}

/**
 * The summary's value as display text, computed over whatever records the view
 * is currently showing. Returns '' when there's nothing to show (no summary
 * picked); '—' when the summary applies but the column has no usable values.
 *
 * `tables` only matters for relation columns, whose text lives in another table.
 */
export function summaryValue(
  field: Field,
  key: SummaryKey | undefined,
  records: RecordRow[],
  tables: Table[] = []
): string {
  if (!key || key === 'none') return ''
  const total = records.length

  switch (key) {
    case 'empty':
    case 'filled':
    case 'percentEmpty':
    case 'percentFilled': {
      const empty = records.reduce(
        (count, r) => (isEmptyValue(field, r.values[field.id]) ? count + 1 : count),
        0
      )
      if (key === 'empty') return String(empty)
      if (key === 'filled') return String(total - empty)
      if (key === 'percentEmpty') return formatPercent(empty, total)
      return formatPercent(total - empty, total)
    }
    case 'unique':
    case 'percentUnique': {
      const seen = new Set<string>()
      records.forEach((r) => {
        const value = r.values[field.id]
        if (!isEmptyValue(field, value)) seen.add(displayValue(field, value, tables))
      })
      return key === 'unique' ? String(seen.size) : formatPercent(seen.size, total)
    }
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max':
    case 'range': {
      const numbers = numberValues(field, records)
      if (numbers.length === 0) return '—'
      switch (key) {
        case 'sum':
          return formatNumber(numbers.reduce((a, b) => a + b, 0))
        case 'average':
          return formatNumber(numbers.reduce((a, b) => a + b, 0) / numbers.length)
        case 'median': {
          const sorted = [...numbers].sort((a, b) => a - b)
          const mid = Math.floor(sorted.length / 2)
          return formatNumber(
            sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
          )
        }
        case 'min':
          return formatNumber(Math.min(...numbers))
        case 'max':
          return formatNumber(Math.max(...numbers))
        default:
          return formatNumber(Math.max(...numbers) - Math.min(...numbers))
      }
    }
    case 'earliest':
    case 'latest':
    case 'dateRange': {
      const dates = dateValues(field, records)
      if (dates.length === 0) return '—'
      if (key === 'earliest') return displayValue(field, dates[0])
      if (key === 'latest') return displayValue(field, dates[dates.length - 1])
      const days = daysBetween(dates[0], dates[dates.length - 1])
      if (days === undefined) return '—'
      return `${days.toLocaleString()} ${days === 1 ? 'day' : 'days'}`
    }
    default:
      return ''
  }
}
