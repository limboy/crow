import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { RecordBadge } from './RecordBadge'

export type LinkedRecordLabel = { id: string; label: string }

/** How many linked records to show before the rest collapse behind a "+N
 *  more" button, where nothing is clipping them — enough to be useful on a
 *  card without turning it into a list of everything. */
const VISIBLE_BY_LINE_CLAMP: Record<number, number> = { 1: 3, 2: 6, 4: 12, 9: 24 }

/** The same, for a row that clips at `lineClamp` lines. A label can be wide
 *  enough to take a line to itself, so the only cap that keeps the button on
 *  screen in the worst case is one that leaves a line free for it. */
function clippedLimit(lineClamp: number): number {
  // One line is the exception: there the button sits inline and holds its
  // width, so extra badges narrow rather than push it off the end.
  return lineClamp === 1 ? 3 : lineClamp - 1
}

/**
 * The linked records of a relation cell, capped at what the row can show.
 * Everything past the cap moves into a "+N more" button that opens the full
 * list — without it the overflow is simply clipped, and a cell with twenty
 * links looks the same as one with three.
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
   *  a table cell is. A second line has nowhere to go in a one-line row, so
   *  the button stays on the first one there. */
  clipped?: boolean
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const singleLine = clipped && lineClamp === 1
  const limit = clipped
    ? clippedLimit(lineClamp)
    : (VISIBLE_BY_LINE_CLAMP[lineClamp] ?? lineClamp * 3)
  // Collapsing a single record into "+1 more" trades a label for a button of
  // the same width, so only cap once at least two would be hidden.
  const visible = records.length > limit + 1 ? records.slice(0, limit) : records
  const hiddenCount = records.length - visible.length

  return (
    <span
      className={cn(
        'flex items-center gap-x-1 gap-y-1.5',
        singleLine ? 'flex-nowrap' : 'flex-wrap',
        className
      )}
    >
      {visible.map((record) => (
        // On one line the badges give up width to the button rather than
        // pushing it off the edge, where it was the part you couldn't read.
        <RecordBadge
          key={record.id}
          label={record.label}
          className={singleLine ? 'min-w-0' : undefined}
        />
      ))}
      {hiddenCount > 0 && (
        // Where there's room for another line the button takes one of its own,
        // rather than trailing a badge that the cell is clipping on the right.
        <span className={cn('flex', singleLine ? 'shrink-0' : 'basis-full')}>
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
                  className="inline-flex cursor-pointer items-center rounded-md border border-dashed bg-muted/60 px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  +{hiddenCount} more
                </span>
              }
            />
            <PopoverContent align="start" className="max-h-72 w-64 gap-2 overflow-y-auto p-2">
              <span className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
                {records.map((record) => (
                  <RecordBadge key={record.id} label={record.label} />
                ))}
              </span>
            </PopoverContent>
          </Popover>
        </span>
      )}
    </span>
  )
}
