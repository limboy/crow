/**
 * The stat tile a `metric` chart renders: one aggregate over every record the
 * view shows. A single number is a worse bar chart, so this is a figure rather
 * than a plot — label above, value below, and the records it was taken over
 * underneath.
 *
 * Deliberately not `tabular-nums`: equal-width digits make a large standalone
 * number read loose.
 */
export function MetricTile({
  value,
  label,
  recordCount
}: {
  value: string
  /** What the figure measures. Left out when the card's title already says
   *  it, which is what an unnamed chart's auto-title amounts to. */
  label?: string
  recordCount: number
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col justify-center gap-1 py-3">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <span className="text-4xl font-semibold leading-none">{value}</span>
      <span className="text-xs text-muted-foreground">
        over {recordCount.toLocaleString()} {recordCount === 1 ? 'record' : 'records'}
      </span>
    </div>
  )
}
