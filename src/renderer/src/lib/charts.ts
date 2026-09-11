import { addDays, addMonths, addWeeks, addYears, format as formatDate, startOfWeek } from 'date-fns'
import { ChartBar, ChartColumn, ChartLine, ChartPie, Hash, type LucideIcon } from 'lucide-react'
import type {
  ChartAggregate,
  ChartDateGrain,
  ChartSize,
  ChartSort,
  ChartSpec,
  ChartType,
  Field,
  RecordRow,
  Table
} from '@shared/types'
import {
  cellValue,
  choicesByIds,
  fieldDateParts,
  isComputedField,
  linkedRecordIds,
  recordLabel,
  relationTable
} from './fields'
import { applyFilters, groupRecords } from './derive'
import { numberValues } from './summary'

/**
 * Everything a dashboard chart needs between the records a view shows and the
 * SVG that draws them: which fields a chart may read, how records bucket into
 * categories, and how a bucket becomes one number.
 *
 * Kept free of React so the same computation backs the figure, its tooltip and
 * its table twin without any of them re-deriving it.
 */

export interface ChartTypeInfo {
  type: ChartType
  label: string
  icon: LucideIcon
  /** One line in the picker, saying what the form is for. */
  hint: string
}

export const CHART_TYPES: ChartTypeInfo[] = [
  { type: 'metric', label: 'Number', icon: Hash, hint: 'A single headline figure' },
  { type: 'bar', label: 'Bar', icon: ChartBar, hint: 'Compare categories, long names' },
  { type: 'column', label: 'Column', icon: ChartColumn, hint: 'Compare categories side by side' },
  { type: 'line', label: 'Line', icon: ChartLine, hint: 'A trend across a date field' },
  { type: 'donut', label: 'Donut', icon: ChartPie, hint: 'Part-to-whole, up to 6 slices' }
]

export function chartTypeInfo(type: ChartType): ChartTypeInfo {
  return CHART_TYPES.find((info) => info.type === type) ?? CHART_TYPES[0]
}

export interface ChartAggregateInfo {
  key: ChartAggregate
  label: string
  /** Prefixed to the value field's name in a chart's subtitle. */
  short: string
}

export const CHART_AGGREGATES: ChartAggregateInfo[] = [
  { key: 'count', label: 'Count of records', short: 'Records' },
  { key: 'sum', label: 'Sum', short: 'Sum of' },
  { key: 'average', label: 'Average', short: 'Average' },
  { key: 'median', label: 'Median', short: 'Median' },
  { key: 'min', label: 'Min', short: 'Min' },
  { key: 'max', label: 'Max', short: 'Max' }
]

function chartAggregateInfo(key: ChartAggregate): ChartAggregateInfo {
  return CHART_AGGREGATES.find((info) => info.key === key) ?? CHART_AGGREGATES[0]
}

export interface ChartDateGrainInfo {
  value: ChartDateGrain
  label: string
}

export const CHART_DATE_GRAINS: ChartDateGrainInfo[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' }
]

export const CHART_SORTS: { value: ChartSort; label: string }[] = [
  { value: 'category', label: 'Category order' },
  { value: 'valueDesc', label: 'Value, high to low' },
  { value: 'valueAsc', label: 'Value, low to high' }
]

export const CHART_SIZES: { value: ChartSize; label: string }[] = [
  { value: 'half', label: 'Half width' },
  { value: 'full', label: 'Full width' }
]

/** Buckets a chart plots before it starts folding or trimming. */
export const DEFAULT_CHART_LIMIT = 8

/** Slices past this stop being readable as shares of a circle. */
const MAX_DONUT_SLICES = 6

/** Key of the bucket a chart folds its smallest categories into. */
const OTHER_BUCKET_KEY = '__other__'

/** Palette slots, assigned in this fixed order and never cycled — see
 *  `main.css`. A bucket keeps its slot whatever the sort does, so a reader who
 *  learned "Done is green" isn't shown a repainted chart after a filter. */
const CHART_COLOR_SLOTS = 8

export function chartColor(colorIndex: number): string {
  return colorIndex < 0 || colorIndex >= CHART_COLOR_SLOTS
    ? 'var(--chart-other)'
    : `var(--chart-${colorIndex + 1})`
}

/** The one hue a single-series chart draws every mark in. Length already
 *  carries the magnitude, so shading bars by value would spend the colour
 *  channel on information the chart shows twice. */
export const CHART_SERIES_COLOR = chartColor(0)

/** Fields whose values make sense as categories. Media fields don't: a bucket
 *  per file url says nothing. */
export function canGroupBy(field: Field): boolean {
  switch (field.type) {
    case 'image':
    case 'audio':
    case 'video':
    case 'attachment':
      return false
    default:
      return true
  }
}

/** Fields an aggregate other than `count` can read. */
export function canAggregate(field: Field): boolean {
  return field.type === 'number' || field.type === 'rating'
}

/** Whether a grouping field buckets onto a timeline rather than into
 *  categories — which decides the date-grain control, gap filling, and
 *  whether the tail folds into "Other" or is trimmed to the recent end. */
export function isDateGroupField(field: Field | undefined): boolean {
  return field !== undefined && (field.type === 'date' || isComputedField(field.type))
}

/** What a chart still needs before it can draw anything, as a sentence for the
 *  card's prompt; undefined once it's ready. */
export function chartIssue(spec: ChartSpec, fields: Field[]): string | undefined {
  const groupField = fields.find((f) => f.id === spec.groupByFieldId)
  if (spec.type !== 'metric' && !groupField) return 'Pick a field to group by'
  if (spec.aggregate === 'count') return undefined
  const valueField = fields.find((f) => f.id === spec.valueFieldId)
  if (!valueField || !canAggregate(valueField)) {
    return `Pick a number field to ${chartAggregateInfo(spec.aggregate).label.toLowerCase()}`
  }
  return undefined
}

/** The chart's subtitle: what its numbers measure. */
export function chartMeasureLabel(spec: ChartSpec, fields: Field[]): string {
  const info = chartAggregateInfo(spec.aggregate)
  if (spec.aggregate === 'count') return 'Records'
  const valueField = fields.find((f) => f.id === spec.valueFieldId)
  return valueField ? `${info.short} ${valueField.name}` : info.label
}

export interface ChartBucket {
  /** Stable within a chart — a choice id, an ISO date prefix, or the bucket's
   *  own text. Used as a React key and to match a hovered mark. */
  key: string
  label: string
  /**
   * Palette slot, and only the donut spends it — the other forms draw one
   * series in one hue. Taken from the bucket's place in the grouping field's
   * own order (a select field's choices, a relation's rows) rather than its
   * place after sorting, so a filter that drops a category never repaints the
   * ones that survive. Fields with no declared order of their own — plain text,
   * say — fall back to rank among the values actually present.
   */
  colorIndex: number
  value: number
  /** Records behind the bucket, which the table twin reports alongside. */
  count: number
  /** Unique source rows, including all categories folded into Other. */
  recordIds: string[]
}

export interface ChartData {
  buckets: ChartBucket[]
  /** A `metric`'s single figure, and what a donut's slices add up to. */
  total: number
  /** Records the chart aggregated over. */
  recordCount: number
  recordIds: string[]
  /** Categories folded into the trailing "Other" bucket, 0 when none were. */
  folded: number
  /** Buckets dropped off the old end of a timeline to honour the limit. */
  trimmed: number
  /** Why there's nothing to draw, when the chart is configured but unplottable. */
  note?: string
}

const EMPTY_DATA: ChartData = {
  buckets: [],
  total: 0,
  recordCount: 0,
  recordIds: [],
  folded: 0,
  trimmed: 0
}

/** One bucket before it's been aggregated. */
interface RawBucket {
  key: string
  label: string
  colorIndex: number
  records: RecordRow[]
}

function grainStart(grain: ChartDateGrain, date: string): string {
  switch (grain) {
    case 'day':
      return date
    case 'week':
      return formatDate(
        startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 1 }),
        'yyyy-MM-dd'
      )
    case 'month':
      return date.slice(0, 7)
    case 'year':
      return date.slice(0, 4)
  }
}

function grainLabel(grain: ChartDateGrain, key: string): string {
  switch (grain) {
    case 'day':
      return formatDate(new Date(`${key}T00:00:00`), 'MMM d')
    case 'week':
      return formatDate(new Date(`${key}T00:00:00`), 'MMM d')
    case 'month':
      return formatDate(new Date(`${key}-01T00:00:00`), 'MMM yyyy')
    case 'year':
      return key
  }
}

function grainNext(grain: ChartDateGrain, key: string): string {
  switch (grain) {
    case 'day':
      return formatDate(addDays(new Date(`${key}T00:00:00`), 1), 'yyyy-MM-dd')
    case 'week':
      return formatDate(addWeeks(new Date(`${key}T00:00:00`), 1), 'yyyy-MM-dd')
    case 'month':
      return formatDate(addMonths(new Date(`${key}-01T00:00:00`), 1), 'yyyy-MM')
    case 'year':
      return formatDate(addYears(new Date(`${key}-01-01T00:00:00`), 1), 'yyyy')
  }
}

/**
 * Buckets by calendar period. Records with no readable date sit outside the
 * timeline entirely and are left out, and every period between the first and
 * last one is emitted even when empty — a month nobody wrote in is a real zero,
 * and skipping it would bend the line.
 */
function dateBuckets(records: RecordRow[], field: Field, grain: ChartDateGrain): RawBucket[] {
  const byKey = new Map<string, RecordRow[]>()
  for (const record of records) {
    const parts = fieldDateParts(field, cellValue(field, record))
    if (!parts) continue
    const key = grainStart(grain, parts.date)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(record)
    else byKey.set(key, [record])
  }
  if (byKey.size === 0) return []

  const keys = [...byKey.keys()].sort()
  const filled: RawBucket[] = []
  const last = keys[keys.length - 1]
  // Guarded by the key it is walking toward rather than a count, so a corrupt
  // date can't spin this forever.
  for (let key = keys[0]; key <= last; key = grainNext(grain, key)) {
    filled.push({
      key,
      label: grainLabel(grain, key),
      colorIndex: 0,
      records: byKey.get(key) ?? []
    })
    if (filled.length > 2000) break
  }
  return filled
}

/**
 * Buckets a field that holds several values at once — a multi-select's choices,
 * a relation's links. A record lands in every bucket it names, so the buckets
 * count more records between them than the view holds; that's the honest answer
 * for "how many records are tagged Urgent".
 */
function multiValueBuckets(records: RecordRow[], field: Field, tables: Table[]): RawBucket[] {
  const order = new Map<string, { label: string; colorIndex: number }>()
  if (field.type === 'multiSelect') {
    field.options?.choices.forEach((choice, index) =>
      order.set(choice.id, { label: choice.name, colorIndex: index })
    )
  }
  const byKey = new Map<string, RecordRow[]>()
  const none: RecordRow[] = []

  for (const record of records) {
    const value = cellValue(field, record)
    const keys =
      field.type === 'multiSelect'
        ? choicesByIds(field, value).map((choice) => choice.id)
        : linkedRecordIds(value)
    if (keys.length === 0) {
      none.push(record)
      continue
    }
    for (const key of keys) {
      const bucket = byKey.get(key)
      if (bucket) bucket.push(record)
      else byKey.set(key, [record])
    }
  }

  if (field.type === 'relation') {
    // Ordered by the linked table's own row order rather than by label, so a
    // record keeps its place — and so its colour — however the dashboard is
    // filtered or the linked record renamed.
    const target = relationTable(field, tables)
    target?.records.forEach((record, index) => {
      if (byKey.has(record.id))
        order.set(record.id, { label: recordLabel(target, record), colorIndex: index })
    })
    for (const id of byKey.keys()) {
      // A link whose record was deleted in the other table isn't a category
      // worth a hue of its own, so it takes the neutral one.
      if (!order.has(id)) order.set(id, { label: 'Deleted record', colorIndex: -1 })
    }
  }

  const buckets = [...byKey.entries()]
    .map(([key, bucketRecords]) => ({
      key,
      label: order.get(key)?.label ?? key,
      colorIndex: order.get(key)?.colorIndex ?? 0,
      records: bucketRecords
    }))
    .sort((a, b) => a.colorIndex - b.colorIndex)

  if (none.length > 0) {
    buckets.push({ key: '__empty__', label: 'Empty', colorIndex: buckets.length, records: none })
  }
  return buckets
}

function rawBuckets(
  records: RecordRow[],
  field: Field,
  grain: ChartDateGrain,
  tables: Table[]
): RawBucket[] {
  if (isDateGroupField(field)) return dateBuckets(records, field, grain)
  if (field.type === 'multiSelect' || field.type === 'relation') {
    return multiValueBuckets(records, field, tables)
  }
  return groupRecords(records, field, tables).map((group, index) => ({
    key: group.key,
    label: group.label,
    colorIndex: index,
    records: group.records
  }))
}

/**
 * One bucket's number. `count` always has an answer; the arithmetic aggregates
 * need at least one numeric cell, and a bucket with none is reported as
 * undefined rather than plotted as a zero it never measured.
 */
function aggregateRecords(
  records: RecordRow[],
  aggregate: ChartAggregate,
  valueField: Field | undefined
): number | undefined {
  if (aggregate === 'count') return records.length
  if (!valueField) return undefined
  const numbers = numberValues(valueField, records)
  if (numbers.length === 0) return aggregate === 'sum' ? 0 : undefined
  switch (aggregate) {
    case 'sum':
      return numbers.reduce((a, b) => a + b, 0)
    case 'average':
      return numbers.reduce((a, b) => a + b, 0) / numbers.length
    case 'median': {
      const sorted = [...numbers].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
    case 'min':
      return Math.min(...numbers)
    case 'max':
      return Math.max(...numbers)
  }
}

/** A chart's default bucket order: a timeline keeps its own, everything else
 *  leads with the largest. */
function effectiveSort(spec: ChartSpec, groupField: Field | undefined): ChartSort {
  if (spec.sort) return spec.sort
  return isDateGroupField(groupField) ? 'category' : 'valueDesc'
}

function effectiveLimit(spec: ChartSpec): number {
  const limit = spec.limit ?? DEFAULT_CHART_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_CHART_LIMIT
  return Math.min(limit, spec.type === 'donut' ? MAX_DONUT_SLICES : 100)
}

/**
 * Everything a chart draws, derived from the records the view is already
 * showing, narrowed by the chart’s own filters. Dashboard filters are applied
 * upstream, so a chart can never re-include a row the dashboard excluded.
 */
export function chartData(
  spec: ChartSpec,
  fields: Field[],
  records: RecordRow[],
  tables: Table[] = []
): ChartData {
  const groupField = fields.find((f) => f.id === spec.groupByFieldId)
  const valueField = fields.find((f) => f.id === spec.valueFieldId)
  if (chartIssue(spec, fields)) return EMPTY_DATA

  records = applyFilters(records, spec.filters ?? [], fields, spec.filterMatch ?? 'all')
  const recordIds = records.map((record) => record.id)
  const total = aggregateRecords(records, spec.aggregate, valueField)
  if (spec.type === 'metric' || !groupField) {
    return { ...EMPTY_DATA, total: total ?? 0, recordCount: records.length, recordIds }
  }

  const grain = spec.dateGrain ?? 'month'
  const chronological = isDateGroupField(groupField)
  // The bucket's own records ride along until folding is done, so an "Other"
  // average is taken over records rather than over averages.
  const aggregated = rawBuckets(records, groupField, grain, tables).flatMap((bucket) => {
    // A chronological bucket stays even when it's empty: the gap is the point.
    if (bucket.records.length === 0 && !chronological) return []
    const value = aggregateRecords(bucket.records, spec.aggregate, valueField)
    if (value === undefined) return []
    return [{ ...bucket, value, count: bucket.records.length }]
  })

  const limit = effectiveLimit(spec)
  let plotted = aggregated
  let folded = 0
  let trimmed = 0

  if (chronological) {
    // A timeline can't fold its tail into "Other" without lying about when
    // things happened, so it keeps the recent end and says what it dropped.
    trimmed = Math.max(0, plotted.length - limit)
    plotted = plotted.slice(trimmed)
  } else {
    const sort = effectiveSort(spec, groupField)
    if (sort !== 'category') {
      plotted = [...plotted].sort((a, b) =>
        sort === 'valueAsc' ? a.value - b.value : b.value - a.value
      )
    }
    if (plotted.length > limit) {
      // Ranked by value however the axis is ordered, so "Other" always holds
      // the smallest categories rather than the last ones alphabetically.
      const kept = new Set(
        [...plotted]
          .sort((a, b) => b.value - a.value)
          .slice(0, limit - 1)
          .map((bucket) => bucket.key)
      )
      const tail = plotted.filter((bucket) => !kept.has(bucket.key))
      folded = tail.length
      plotted = [
        ...plotted.filter((bucket) => kept.has(bucket.key)),
        {
          key: OTHER_BUCKET_KEY,
          label: `Other (${folded})`,
          colorIndex: -1,
          records: tail.flatMap((bucket) => bucket.records),
          // Only totals add up across folded categories — an average of
          // averages isn't one — so the rest re-aggregate the tail's records.
          value:
            spec.aggregate === 'count' || spec.aggregate === 'sum'
              ? tail.reduce((sum, bucket) => sum + bucket.value, 0)
              : (aggregateRecords(
                  tail.flatMap((bucket) => bucket.records),
                  spec.aggregate,
                  valueField
                ) ?? 0),
          count: tail.reduce((sum, bucket) => sum + bucket.count, 0)
        }
      ]
    }
  }

  const buckets: ChartBucket[] = plotted.map(
    ({ key, label, colorIndex, value, count, records }) => ({
      key,
      label,
      colorIndex,
      value,
      count,
      recordIds: [...new Set(records.map((record) => record.id))]
    })
  )
  if (spec.type === 'donut' && buckets.some((bucket) => bucket.value < 0)) {
    return {
      ...EMPTY_DATA,
      total: total ?? 0,
      recordCount: records.length,
      recordIds,
      note: 'A donut can\u2019t show negative values \u2014 try a bar chart.'
    }
  }
  return { buckets, total: total ?? 0, recordCount: records.length, recordIds, folded, trimmed }
}

/** Full-precision value text, for tooltips, direct labels and the table twin. */
export function formatChartValue(value: number, aggregate: ChartAggregate): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, {
    maximumFractionDigits: aggregate === 'count' ? 0 : 2
  })
}

/** Shortened for a headline figure or an axis tick, where the digits matter
 *  less than the magnitude: 1,284 · 12.9K · 4.2M. */
export function formatCompactValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude < 10_000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: magnitude < 100 ? 2 : 0 })
  }
  return value.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
}

/**
 * Round tick values spanning the data, always including zero so bars are read
 * against a real baseline. Returns at least two ticks.
 *
 * A scale whose values are all whole numbers — a record count, most often —
 * never steps in fractions: "1.5 records" is not a quantity.
 */
export function chartTicks(values: number[], count = 4): number[] {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  if (max === min) return [0, 1]
  const rough = (max - min) / count
  const step = values.every(Number.isInteger) ? Math.max(1, niceStep(rough)) : niceStep(rough)
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  // Accumulated float error would push the last tick past `end` and drop it.
  for (let i = 0; start + i * step <= end + step / 1000; i += 1) {
    ticks.push(Number((start + i * step).toPrecision(12)))
  }
  return ticks
}

/** The nearest 1/2/5×10ⁿ at or above `rough`, so ticks land on numbers people
 *  read without counting decimals. */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(rough))
  const scaled = rough / power
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return step * power
}

/** A chart's own name, falling back to what it measures so an unnamed tile
 *  still says what it is. */
export function chartTitle(spec: ChartSpec, fields: Field[]): string {
  const trimmed = spec.name.trim()
  if (trimmed) return trimmed
  const groupField = fields.find((f) => f.id === spec.groupByFieldId)
  const measure = chartMeasureLabel(spec, fields)
  return groupField ? `${measure} by ${groupField.name}` : measure
}

/** The grouping field's label for a chart's category axis. */
export function chartCategoryLabel(spec: ChartSpec, fields: Field[]): string {
  return fields.find((f) => f.id === spec.groupByFieldId)?.name ?? 'Category'
}
