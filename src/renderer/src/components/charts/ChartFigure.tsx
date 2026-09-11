import { useMemo, useState } from 'react'
import type { ChartSpec, RecordRow, Table } from '@shared/types'
import {
  CHART_SERIES_COLOR,
  chartCategoryLabel,
  chartColor,
  chartData,
  chartIssue,
  chartMeasureLabel,
  chartTitle,
  formatChartValue,
  formatCompactValue,
  type ChartBucket
} from '@/lib/charts'
import { BarChart } from './BarChart'
import { ColumnChart } from './ColumnChart'
import { DonutChart } from './DonutChart'
import { LineChart } from './LineChart'
import { MetricTile } from './MetricTile'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { recordLabel } from '@/lib/fields'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * One chart's body: it derives the chart's numbers from the records the view
 * is showing, picks the form, and says plainly when it can't draw one.
 *
 * `showTable` swaps the figure for the same numbers as a table — the twin every
 * chart carries, so no value is reachable only by hovering or only through a
 * colour.
 */
export function ChartFigure({
  spec,
  table,
  onOpenRecord,
  records,
  tables,
  showTable
}: {
  spec: ChartSpec
  table: Table
  onOpenRecord: (recordId: string) => void
  records: RecordRow[]
  tables: Table[]
  showTable: boolean
}): React.JSX.Element {
  const fields = table.fields
  const [selection, setSelection] = useState<{ key?: string } | null>(null)
  /** Which window of a timeline is on show; 0 is the most recent one. */
  const [page, setPage] = useState(0)
  // Walks every record the view shows, so it stays off the path of renders that
  // only opened a menu or moved a tile.
  const data = useMemo(
    () => chartData(spec, fields, records, tables, page),
    [spec, fields, records, tables, page]
  )
  const issue = chartIssue(spec, fields)
  const measure = chartMeasureLabel(spec, fields)
  const title = chartTitle(spec, fields)
  const formatValue = (value: number): string => formatChartValue(value, spec.aggregate)

  if (issue) return <ChartNote>{issue}</ChartNote>
  if (data.note) return <ChartNote>{data.note}</ChartNote>

  const selectedBucket =
    selection?.key === undefined
      ? undefined
      : data.buckets.find((bucket) => bucket.key === selection.key)
  const selectedIds = new Set(
    !selection ? [] : selection.key === undefined ? data.recordIds : (selectedBucket?.recordIds ?? [])
  )
  const selectedRecords = selection ? records.filter((record) => selectedIds.has(record.id)) : []
  const onBucketClick = (bucket: ChartBucket): void => setSelection({ key: bucket.key })
  const drillDown = (
    <Dialog open={selection !== null} onOpenChange={(open) => !open && setSelection(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {title}
            {selectedBucket ? ` · ${selectedBucket.label}` : ''}
          </DialogTitle>
          <DialogDescription>
            {selectedRecords.length.toLocaleString()}{' '}
            {selectedRecords.length === 1 ? 'record' : 'records'}. Select a record to view or edit
            it.
            {selectedBucket &&
              selectedBucket.count > selectedRecords.length &&
              ' Records belonging to multiple categories are listed once.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {selectedRecords.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No records in this group.
            </p>
          ) : (
            selectedRecords.map((record) => (
              <Button
                key={record.id}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setSelection(null)
                  onOpenRecord(record.id)
                }}
              >
                <span className="truncate">{recordLabel(table, record)}</span>
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )

  if (spec.type === 'metric') {
    return (
      <>
        <button
          type="button"
          className="w-full flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`View records: ${title}, ${formatValue(data.total)}`}
          onClick={() => setSelection({})}
        >
          <MetricTile
            value={formatCompactValue(data.total)}
            label={title === measure ? undefined : measure}
            recordCount={data.recordCount}
          />
        </button>
        {drillDown}
      </>
    )
  }

  if (data.buckets.length === 0) {
    return <ChartNote>No records to chart yet.</ChartNote>
  }

  return (
    <div className="flex flex-col gap-2">
      {showTable ? (
        <ChartTable
          buckets={data.buckets}
          categoryLabel={chartCategoryLabel(spec, fields)}
          measure={measure}
          formatValue={formatValue}
          colored={spec.type === 'donut'}
          onBucketClick={onBucketClick}
          showCounts={spec.aggregate !== 'count'}
        />
      ) : spec.type === 'bar' ? (
        <BarChart onBucketClick={onBucketClick} buckets={data.buckets} formatValue={formatValue} />
      ) : spec.type === 'column' ? (
        <ColumnChart
          onBucketClick={onBucketClick}
          buckets={data.buckets}
          formatValue={formatValue}
        />
      ) : spec.type === 'line' ? (
        <LineChart onBucketClick={onBucketClick} buckets={data.buckets} formatValue={formatValue} />
      ) : (
        <DonutChart
          onBucketClick={onBucketClick}
          buckets={data.buckets}
          formatValue={formatValue}
          centerLabel={measure}
        />
      )}
      {drillDown}
      <ChartFootnote
        folded={data.folded}
        trimmedBefore={data.trimmedBefore}
        trimmedAfter={data.trimmedAfter}
        shown={data.buckets.length}
        dateGrain={spec.dateGrain ?? 'month'}
        // Stepping from the page that was drawn, not the one asked for, so a
        // click still moves after a filter has shortened the timeline.
        onPage={(step) => setPage(Math.max(0, data.page + step))}
      />
    </div>
  )
}

function ChartNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * What the chart left out, so a trimmed axis never passes for the whole set.
 *
 * A timeline that doesn't fit gets the rest of it within reach: the same
 * sentence names the stretch on show, with a step either way around it.
 * `onPage` moves the window back (+1) or forward (-1) in time.
 */
function ChartFootnote({
  folded,
  trimmedBefore,
  trimmedAfter,
  shown,
  dateGrain,
  onPage
}: {
  folded: number
  trimmedBefore: number
  trimmedAfter: number
  shown: number
  dateGrain: NonNullable<ChartSpec['dateGrain']>
  onPage: (step: number) => void
}): React.JSX.Element | null {
  const total = trimmedBefore + shown + trimmedAfter
  if (folded === 0 && trimmedBefore === 0 && trimmedAfter === 0) return null
  if (folded > 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {`${folded} smaller ${folded === 1 ? 'category' : 'categories'} folded into Other.`}
      </p>
    )
  }
  return (
    <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={trimmedBefore === 0}
        onClick={() => onPage(1)}
        aria-label={`Show the previous ${shown} ${dateGrain}s`}
      >
        <ChevronLeft />
      </Button>
      <span className="tabular-nums">
        {`${(trimmedBefore + 1).toLocaleString()}\u2013${(trimmedBefore + shown).toLocaleString()} of ${total.toLocaleString()} ${dateGrain}s`}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={trimmedAfter === 0}
        onClick={() => onPage(-1)}
        aria-label={`Show the next ${shown} ${dateGrain}s`}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}

/** The table twin: the same buckets, as text. */
function ChartTable({
  buckets,
  categoryLabel,
  measure,
  formatValue,
  colored,
  showCounts,
  onBucketClick
}: {
  buckets: ChartBucket[]
  categoryLabel: string
  measure: string
  formatValue: (value: number) => string
  /** Donut slices are told apart by hue, so the table carries the swatch too. */
  colored: boolean
  /** Off when the measure is the record count, which would print twice. */
  showCounts: boolean
  onBucketClick: (bucket: ChartBucket) => void
}): React.JSX.Element {
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-2 text-left font-medium">{categoryLabel}</th>
            <th className="py-1.5 pr-2 text-right font-medium">{measure}</th>
            {showCounts && <th className="py-1.5 text-right font-medium">Records</th>}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key} className="border-b last:border-0">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{
                      background: colored ? chartColor(bucket.colorIndex) : CHART_SERIES_COLOR
                    }}
                  />
                  <Button
                    variant="link"
                    size="xs"
                    className="min-w-0 px-0"
                    onClick={() => onBucketClick(bucket)}
                    aria-label={`View records: ${bucket.label}`}
                  >
                    <span className="truncate">{bucket.label}</span>
                  </Button>
                </span>
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatValue(bucket.value)}</td>
              {showCounts && (
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {bucket.count.toLocaleString()}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
