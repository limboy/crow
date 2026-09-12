import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { RecordBadge } from './RecordBadge'

export type LinkedRecordLabel = { id: string; label: string }

/** How many linked records to show before the rest collapse behind a "+N
 *  more" button, where nothing is clipping them — enough to be useful on a
 *  card without turning it into a list of everything. */
const VISIBLE_BY_LINE_CLAMP: Record<number, number> = { 1: 3, 2: 6, 4: 12, 9: 24 }

/** How many lines a clipped row of each tier has room for — fewer than
 *  `lineClamp`, because a badge line is taller than the line of text that
 *  number counts. A badge is 22px (a 16px line box, 4px of padding, 2px of
 *  border) and they stack 4px apart, inside a content box of the tier height
 *  less its 1px border and the cell's vertical padding: short 23px fits 1,
 *  medium 55px fits 2, tall 103px fits 4, extra tall 199px fits 7. */
const LINES_BY_LINE_CLAMP: Record<number, number> = { 1: 1, 2: 2, 4: 4, 9: 7 }

/**
 * The linked records of a relation cell, one per line, capped at the lines the
 * row has. Everything past the cap moves into a "+N more" button that opens
 * the full list — without it the overflow is simply clipped, and a cell with
 * twenty links looks the same as one with three.
 */
export function RelationBadges({
  records,
  lineClamp = 1,
  clipped = false,
  className
}: {
  records: LinkedRecordLabel[]
  lineClamp?: number
  /** Whether the container is a fixed-height row that clips its overflow, as
   *  a table cell is — which is what makes it worth counting the lines the
   *  badges are allowed to take. */
  clipped?: boolean
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = LINES_BY_LINE_CLAMP[lineClamp] ?? lineClamp
  // A single-line row can't stack anything: the button shares the line with
  // the badges there, and holds its width while they give theirs up.
  const singleLine = clipped && lines < 2
  // Stacked, every record costs exactly one line — so the cap is just the
  // lines available, less the one the button takes.
  const limit = singleLine ? 3 : clipped ? lines - 1 : (VISIBLE_BY_LINE_CLAMP[lineClamp] ?? 3)
  // Collapsing a single record into "+1 more" trades a label for a button of
  // the same width, so only cap once at least two would be hidden.
  const visible = records.length > limit + 1 ? records.slice(0, limit) : records
  const hiddenCount = records.length - visible.length

  return (
    <span
      className={cn(
        'flex gap-1',
        singleLine ? 'items-center' : 'flex-col items-start',
        className
      )}
    >
      {visible.map((record) => (
        <RecordBadge
          key={record.id}
          label={record.label}
          className={singleLine ? 'min-w-0' : undefined}
        />
      ))}
      {hiddenCount > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            // The cell underneath selects on click and opens its editor on
            // double-click; neither should fire for a press on the button.
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            render={
              <span
                role="button"
                tabIndex={0}
                title={`Show all ${records.length} linked records`}
                className={cn(
                  'inline-flex cursor-pointer items-center rounded-md border border-dashed bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground',
                  singleLine && 'shrink-0'
                )}
              >
                +{hiddenCount} more
              </span>
            }
          />
          <PopoverContent align="start" className="max-h-72 w-64 gap-2 overflow-y-auto p-2">
            <span className="flex flex-col items-start gap-1">
              {records.map((record) => (
                <RecordBadge key={record.id} label={record.label} />
              ))}
            </span>
          </PopoverContent>
        </Popover>
      )}
    </span>
  )
}
