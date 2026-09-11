import type { ChartBucket } from '@/lib/charts'
import { CHART_SERIES_COLOR } from '@/lib/charts'
import { ChartMarkTooltip } from './ChartMarkTooltip'

/** Bars are capped rather than filled to the band, so the leftover is air. */
const BAR_THICKNESS = 20

/**
 * Horizontal bars, one row per category: the form to reach for when category
 * names are long, since each gets a full line to itself.
 *
 * Laid out in CSS rather than SVG — a row of `label | track | value` reflows
 * with the card, truncates its own text, and needs no measuring. Every bar
 * prints its value on the row, which is also what keeps the chart readable for
 * the lighter palette slots.
 */
export function BarChart({
  buckets,
  formatValue,
  color = CHART_SERIES_COLOR
}: {
  buckets: ChartBucket[]
  formatValue: (value: number) => string
  /** Overridden only where a bucket's identity is the point; a plain bar chart
   *  draws every bar in one hue, because length already carries the size. */
  color?: string | ((bucket: ChartBucket) => string)
}): React.JSX.Element {
  const values = buckets.map((bucket) => bucket.value)
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const zero = (-min / span) * 100

  return (
    <div className="flex flex-col gap-1">
      {buckets.map((bucket) => {
        const negative = bucket.value < 0
        const length = (Math.abs(bucket.value) / span) * 100
        const barColor = typeof color === 'function' ? color(bucket) : color
        return (
          <div
            key={bucket.key}
            className="grid grid-cols-[minmax(3rem,7rem)_1fr_auto] items-center gap-2"
          >
            <div className="truncate text-right text-xs text-muted-foreground" title={bucket.label}>
              {bucket.label}
            </div>
            <div className="relative flex items-center" style={{ height: BAR_THICKNESS + 6 }}>
              {min < 0 && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-border"
                  style={{ left: `${zero}%` }}
                />
              )}
              <ChartMarkTooltip
                label={bucket.label}
                value={formatValue(bucket.value)}
                detail={`${bucket.count.toLocaleString()} ${bucket.count === 1 ? 'record' : 'records'}`}
                color={barColor}
                side="top"
              >
                <button
                  type="button"
                  className="absolute transition-opacity hover:opacity-85"
                  style={{
                    top: 3,
                    height: BAR_THICKNESS,
                    background: barColor,
                    // Square where it meets the baseline, rounded at the end
                    // that carries the value.
                    borderRadius: negative ? '4px 0 0 4px' : '0 4px 4px 0',
                    left: negative ? `${zero - length}%` : `${zero}%`,
                    width: `${length}%`,
                    minWidth: bucket.value === 0 ? 0 : 2
                  }}
                >
                  <span className="sr-only">
                    {bucket.label}: {formatValue(bucket.value)}
                  </span>
                </button>
              </ChartMarkTooltip>
            </div>
            <div className="pl-1 text-xs tabular-nums">{formatValue(bucket.value)}</div>
          </div>
        )
      })}
    </div>
  )
}
