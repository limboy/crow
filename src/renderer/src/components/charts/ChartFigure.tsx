import { useMemo } from 'react'
import type { ChartSpec, Field, RecordRow, Table } from '@shared/types'
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
  fields,
  records,
  tables,
  showTable
}: {
  spec: ChartSpec
  fields: Field[]
  records: RecordRow[]
  tables: Table[]
  showTable: boolean
}): React.JSX.Element {
  // Walks every record the view shows, so it stays off the path of renders that
  // only opened a menu or moved a tile.
  const data = useMemo(
    () => chartData(spec, fields, records, tables),
    [spec, fields, records, tables]
  )
  const issue = chartIssue(spec, fields)
  const measure = chartMeasureLabel(spec, fields)
  const title = chartTitle(spec, fields)
  const formatValue = (value: number): string => formatChartValue(value, spec.aggregate)

  if (issue) return <ChartNote>{issue}</ChartNote>
  if (data.note) return <ChartNote>{data.note}</ChartNote>

  if (spec.type === 'metric') {
    return (
      <MetricTile
        value={formatCompactValue(data.total)}
        label={title === measure ? undefined : measure}
        recordCount={data.recordCount}
      />
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
          showCounts={spec.aggregate !== 'count'}
        />
      ) : spec.type === 'bar' ? (
        <BarChart buckets={data.buckets} formatValue={formatValue} />
      ) : spec.type === 'column' ? (
        <ColumnChart buckets={data.buckets} formatValue={formatValue} />
      ) : spec.type === 'line' ? (
        <LineChart buckets={data.buckets} formatValue={formatValue} />
      ) : (
        <DonutChart buckets={data.buckets} formatValue={formatValue} centerLabel={measure} />
      )}
      <ChartFootnote folded={data.folded} trimmed={data.trimmed} shown={data.buckets.length} />
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

/** What the chart left out, so a trimmed axis never passes for the whole set. */
function ChartFootnote({
  folded,
  trimmed,
  shown
}: {
  folded: number
  trimmed: number
  shown: number
}): React.JSX.Element | null {
  if (folded === 0 && trimmed === 0) return null
  return (
    <p className="text-[11px] text-muted-foreground">
      {folded > 0
        ? `${folded} smaller ${folded === 1 ? 'category' : 'categories'} folded into Other.`
        : `Showing the ${shown} most recent of ${shown + trimmed} periods.`}
    </p>
  )
}

/** The table twin: the same buckets, as text. */
function ChartTable({
  buckets,
  categoryLabel,
  measure,
  formatValue,
  colored,
  showCounts
}: {
  buckets: ChartBucket[]
  categoryLabel: string
  measure: string
  formatValue: (value: number) => string
  /** Donut slices are told apart by hue, so the table carries the swatch too. */
  colored: boolean
  /** Off when the measure is the record count, which would print twice. */
  showCounts: boolean
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
                  <span className="truncate">{bucket.label}</span>
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
