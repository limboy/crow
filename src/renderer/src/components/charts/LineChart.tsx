import { useState } from 'react'
import type { ChartBucket } from '@/lib/charts'
import { CHART_SERIES_COLOR, chartTicks, formatCompactValue } from '@/lib/charts'
import { useElementWidth } from '@/lib/useElementWidth'
import { ChartMarkTooltip } from './ChartMarkTooltip'

const PLOT_HEIGHT = 170
const AXIS_WIDTH = 40
/** Room at the right for the end-point's value label. */
const END_LABEL_WIDTH = 46
/** Past this many points a dot per value reads as noise, so only the end keeps one. */
const MAX_DOTS = 14
/** Most category labels the axis prints; the rest are thinned out evenly. */
const MAX_AXIS_LABELS = 6

/**
 * A single series over a date axis. Points are placed in real pixels rather
 * than a scaled viewBox — stretching a viewBox would stretch the stroke and the
 * axis text with it — so the plot waits for its measured width.
 *
 * Only the last point is direct-labelled: a number on every point goes unread.
 * The rest are reachable by hovering (or tabbing to) the column-wide hit areas
 * over the plot, and on the card's table twin.
 */
export function LineChart({
  buckets,
  formatValue
}: {
  buckets: ChartBucket[]
  formatValue: (value: number) => string
}): React.JSX.Element {
  const [plotRef, plotWidth] = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const ticks = chartTicks(buckets.map((bucket) => bucket.value))
  const min = ticks[0]
  const max = ticks[ticks.length - 1]
  const span = max - min || 1

  const width = Math.max(0, plotWidth - END_LABEL_WIDTH)
  const x = (index: number): number =>
    buckets.length <= 1 ? width / 2 : (index / (buckets.length - 1)) * width
  const y = (value: number): number => PLOT_HEIGHT - ((value - min) / span) * PLOT_HEIGHT
  const points = buckets.map((bucket, index) => ({ x: x(index), y: y(bucket.value), bucket }))
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  // The area is a wash between the line and the baseline it is measured from,
  // which is the zero line rather than the bottom of the plot.
  const baseline = Math.min(PLOT_HEIGHT, Math.max(0, y(0)))
  const band = buckets.length > 1 ? width / (buckets.length - 1) : width
  const hitWidth = Math.max(band, 24)
  // Thinned from the end, so the most recent period is always labelled.
  const labelStep = Math.ceil(buckets.length / MAX_AXIS_LABELS)

  return (
    // Headroom for the topmost tick label, which sits above the plot box.
    <div className="flex flex-col pt-3">
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
              className={
                tick === 0 ? 'absolute inset-x-0 h-px bg-border' : 'absolute inset-x-0 h-px bg-border/60'
              }
              style={{ bottom: `${((tick - min) / span) * 100}%` }}
            />
          ))}

          {plotWidth > 0 && (
            <svg
              aria-hidden
              className="absolute inset-y-0 left-0 overflow-visible"
              width={width}
              height={PLOT_HEIGHT}
            >
              {points.length > 1 && (
                <polygon
                  points={`${points[0].x},${baseline} ${line} ${points[points.length - 1].x},${baseline}`}
                  fill={CHART_SERIES_COLOR}
                  opacity={0.1}
                />
              )}
              <polyline
                points={line}
                fill="none"
                stroke={CHART_SERIES_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {points.map((point, index) => {
                const isEnd = index === points.length - 1
                if (!isEnd && points.length > MAX_DOTS && hovered !== index) return null
                return (
                  <circle
                    key={point.bucket.key}
                    cx={point.x}
                    cy={point.y}
                    r={hovered === index ? 5 : 4}
                    fill={CHART_SERIES_COLOR}
                    // A ring in the surface colour keeps the dot legible where
                    // it sits on the line it belongs to.
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                )
              })}
              {hovered !== null && points[hovered] && (
                <line
                  x1={points[hovered].x}
                  x2={points[hovered].x}
                  y1={0}
                  y2={PLOT_HEIGHT}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
              )}
            </svg>
          )}

          {/* One hit area per point, the full height of the plot and never
              narrower than a comfortable target, so the reader aims at a date
              rather than at a 4px dot. */}
          {plotWidth > 0 &&
            points.map((point, index) => (
              <ChartMarkTooltip
                key={point.bucket.key}
                label={point.bucket.label}
                value={formatValue(point.bucket.value)}
                detail={`${point.bucket.count.toLocaleString()} ${point.bucket.count === 1 ? 'record' : 'records'}`}
                color={CHART_SERIES_COLOR}
              >
                <button
                  type="button"
                  className="absolute inset-y-0"
                  style={{ left: Math.max(0, point.x - hitWidth / 2), width: hitWidth }}
                  onPointerEnter={() => setHovered(index)}
                  onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered((current) => (current === index ? null : current))}
                >
                  <span className="sr-only">
                    {point.bucket.label}: {formatValue(point.bucket.value)}
                  </span>
                </button>
              </ChartMarkTooltip>
            ))}

          {plotWidth > 0 && points.length > 0 && (
            <span
              className="pointer-events-none absolute -translate-y-1/2 pl-2 text-xs tabular-nums"
              style={{ left: points[points.length - 1].x, top: points[points.length - 1].y }}
            >
              {formatValue(buckets[buckets.length - 1].value)}
            </span>
          )}
        </div>
      </div>

      <div className="relative h-4" style={{ marginLeft: AXIS_WIDTH }}>
        {plotWidth > 0 &&
          points.map((point, index) =>
            (points.length - 1 - index) % labelStep === 0 ? (
              <span
                key={point.bucket.key}
                className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
                style={{ left: point.x }}
              >
                {point.bucket.label}
              </span>
            ) : null
          )}
      </div>
    </div>
  )
}
