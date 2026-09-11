import type { ChartBucket } from '@/lib/charts'
import { CHART_SERIES_COLOR, chartTicks, formatCompactValue } from '@/lib/charts'
import { useElementWidth } from '@/lib/useElementWidth'
import { ChartMarkTooltip } from './ChartMarkTooltip'

const PLOT_HEIGHT = 170
/** Columns are capped rather than filled to the band, so the leftover is air. */
const MAX_COLUMN_WIDTH = 24
/** The 2px of surface that separates one column from the next. */
const COLUMN_GAP = 2
const AXIS_WIDTH = 40

/**
 * Vertical columns over a category or date axis, with gridlines at round tick
 * values and the value printed on the cap wherever it fits.
 *
 * Columns are CSS boxes: heights are percentages of the plot, so the chart
 * reflows with the card without being measured. The one thing the layout has to
 * know in pixels is how wide a band ends up — a cap label is only drawn when
 * the rendered text will fit inside it, since a clipped number is worse than
 * none (the tooltip and the table twin still carry it).
 */
export function ColumnChart({
  buckets,
  formatValue
}: {
  buckets: ChartBucket[]
  formatValue: (value: number) => string
}): React.JSX.Element {
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>()
  const ticks = chartTicks(buckets.map((bucket) => bucket.value))
  const min = ticks[0]
  const max = ticks[ticks.length - 1]
  const span = max - min || 1
  const zero = ((0 - min) / span) * 100

  const band = buckets.length > 0 ? (plotWidth - COLUMN_GAP * (buckets.length - 1)) / buckets.length : 0
  const labels = buckets.map((bucket) => formatValue(bucket.value))
  // Rough advance width for the 10px axis face; the check only has to be
  // conservative, not exact.
  const widest = Math.max(0, ...labels.map((label) => label.length * 6.1))
  const showCapLabels = plotWidth > 0 && band >= widest + 6

  return (
    // Headroom for the cap labels and the topmost tick, both of which sit
    // above the plot box.
    <div className="flex flex-col pt-4">
      <div className="flex">
        <div
          className="relative shrink-0 text-[10px] text-muted-foreground"
          style={{ width: AXIS_WIDTH, height: PLOT_HEIGHT }}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1.5 -translate-y-1/2 tabular-nums"
              style={{ bottom: `${((tick - min) / span) * 100}%` }}
            >
              {formatCompactValue(tick)}
            </span>
          ))}
        </div>

        <div ref={plotRef} className="relative min-w-0 flex-1" style={{ height: PLOT_HEIGHT }}>
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className={tick === 0 ? 'absolute inset-x-0 h-px bg-border' : 'absolute inset-x-0 h-px bg-border/60'}
              style={{ bottom: `${((tick - min) / span) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-stretch" style={{ gap: COLUMN_GAP }}>
            {buckets.map((bucket, index) => {
              const negative = bucket.value < 0
              const length = (Math.abs(bucket.value) / span) * 100
              return (
                <div key={bucket.key} className="relative min-w-0 flex-1">
                  {showCapLabels && (
                    <span
                      className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-muted-foreground"
                      style={
                        negative
                          ? { top: `calc(${100 - zero + length}% + 3px)` }
                          : { bottom: `calc(${zero + length}% + 3px)` }
                      }
                    >
                      {labels[index]}
                    </span>
                  )}
                  <ChartMarkTooltip
                    label={bucket.label}
                    value={formatValue(bucket.value)}
                    detail={`${bucket.count.toLocaleString()} ${bucket.count === 1 ? 'record' : 'records'}`}
                    color={CHART_SERIES_COLOR}
                  >
                    <button
                      type="button"
                      className="absolute left-1/2 w-full -translate-x-1/2 transition-opacity hover:opacity-85"
                      style={{
                        maxWidth: MAX_COLUMN_WIDTH,
                        background: CHART_SERIES_COLOR,
                        // Square where it meets the baseline, rounded at the cap.
                        borderRadius: negative ? '0 0 4px 4px' : '4px 4px 0 0',
                        height: `${length}%`,
                        minHeight: bucket.value === 0 ? 0 : 2,
                        ...(negative ? { top: `${100 - zero}%` } : { bottom: `${zero}%` })
                      }}
                    >
                      <span className="sr-only">
                        {bucket.label}: {formatValue(bucket.value)}
                      </span>
                    </button>
                  </ChartMarkTooltip>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex pt-1.5" style={{ paddingLeft: AXIS_WIDTH, gap: COLUMN_GAP }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground"
            title={bucket.label}
          >
            {bucket.label}
          </div>
        ))}
      </div>
    </div>
  )
}
