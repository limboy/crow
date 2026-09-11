import { useState } from 'react'
import type { ChartBucket } from '@/lib/charts'
import { chartColor, formatCompactValue } from '@/lib/charts'
import { cn } from '@/lib/utils'

const SIZE = 148
const RING = 24
const OUTER = SIZE / 2
const INNER = OUTER - RING
/** The 2px of surface that separates one slice from the next. */
const SLICE_GAP = 2

/**
 * Part-to-whole for a handful of categories. Unlike the bar forms, a slice has
 * no axis to name it, so this is the one chart that spends the categorical
 * palette — each slice keeps the slot its category was assigned, so a filter
 * that drops a slice never repaints the survivors.
 *
 * The legend is always present and carries every value in text, which is what
 * keeps the chart readable without hovering and without relying on hue alone.
 */
export function DonutChart({
  buckets,
  formatValue,
  centerLabel
}: {
  buckets: ChartBucket[]
  formatValue: (value: number) => string
  centerLabel: string
}): React.JSX.Element {
  const [hovered, setHovered] = useState<string | null>(null)
  const sum = buckets.reduce((running, bucket) => running + bucket.value, 0)

  let angle = -Math.PI / 2
  const slices = buckets.map((bucket) => {
    const sweep = sum > 0 ? (bucket.value / sum) * Math.PI * 2 : 0
    const start = angle
    angle += sweep
    return { bucket, start, end: start + sweep, share: sum > 0 ? bucket.value / sum : 0 }
  })

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} role="presentation">
          {slices.map((slice) => {
            const path = donutSlicePath(slice.start, slice.end)
            if (!path) return null
            return (
              <path
                key={slice.bucket.key}
                d={path}
                fill={chartColor(slice.bucket.colorIndex)}
                className="transition-opacity"
                opacity={hovered === null || hovered === slice.bucket.key ? 1 : 0.35}
                onPointerEnter={() => setHovered(slice.bucket.key)}
                onPointerLeave={() => setHovered(null)}
              >
                <title>
                  {slice.bucket.label}: {formatValue(slice.bucket.value)}
                </title>
              </path>
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {/* The ring's own sum rather than the view's total: a record tagged
              twice lands in two slices, and a folded tail can be trimmed. */}
          <span className="text-xl font-semibold">{formatCompactValue(sum)}</span>
          <span className="max-w-[5.5rem] truncate text-[11px] text-muted-foreground">
            {centerLabel}
          </span>
        </div>
      </div>

      <ul className="flex min-w-[9rem] flex-1 flex-col gap-0.5">
        {slices.map((slice) => (
          <li key={slice.bucket.key}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-accent/60',
                hovered !== null && hovered !== slice.bucket.key && 'opacity-60'
              )}
              onPointerEnter={() => setHovered(slice.bucket.key)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(slice.bucket.key)}
              onBlur={() => setHovered(null)}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: chartColor(slice.bucket.colorIndex) }}
              />
              <span className="min-w-0 flex-1 truncate text-xs" title={slice.bucket.label}>
                {slice.bucket.label}
              </span>
              <span className="text-xs tabular-nums">{formatValue(slice.bucket.value)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {(slice.share * 100).toFixed(slice.share < 0.1 ? 1 : 0)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One annulus sector, inset at both ends by half the surface gap. Returns
 *  undefined for a slice too thin to survive the inset — the legend still
 *  lists it, so nothing is lost by leaving it undrawn. */
function donutSlicePath(start: number, end: number): string | undefined {
  const gap = SLICE_GAP / OUTER
  const from = start + gap / 2
  const to = end - gap / 2
  if (to <= from) return undefined
  const large = to - from > Math.PI ? 1 : 0
  const point = (radius: number, at: number): string =>
    `${(OUTER + Math.cos(at) * radius).toFixed(2)},${(OUTER + Math.sin(at) * radius).toFixed(2)}`
  return [
    `M ${point(OUTER, from)}`,
    `A ${OUTER} ${OUTER} 0 ${large} 1 ${point(OUTER, to)}`,
    `L ${point(INNER, to)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, from)}`,
    'Z'
  ].join(' ')
}
