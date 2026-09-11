import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The readout a chart mark shows on hover and on keyboard focus. The value
 * leads and the category follows — the reader already knows which mark they
 * are pointing at and wants the number — and identity is carried by a short
 * stroke of the mark's own colour rather than by colouring the text.
 *
 * Tooltips here enhance and never gate: every value is also on the card's
 * table twin, and bar rows print theirs beside the bar.
 */
export function ChartMarkTooltip({
  label,
  value,
  detail,
  color,
  side = 'top',
  children
}: {
  label: string
  value: string
  /** A second line — the record count behind an aggregate, say. */
  detail?: string
  color: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** The mark itself, which becomes the hover/focus target. */
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="flex-col items-start gap-0.5 py-2">
        <span className="text-sm font-semibold tabular-nums">{value}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />
          {label}
        </span>
        {detail && <span className="opacity-70">{detail}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
