import { cn } from '@/lib/utils'

/** A linked record, as shown inside a relation cell. Deliberately neutral —
 *  unlike a select choice, a record has no colour of its own. */
export function RecordBadge({
  label,
  className
}: {
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-md border bg-muted/60 px-1.5 py-0.5 text-xs',
        className
      )}
    >
      {label}
    </span>
  )
}
