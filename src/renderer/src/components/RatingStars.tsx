import { Star } from 'lucide-react'
import { RATING_MAX } from '@/lib/fields'
import { cn } from '@/lib/utils'

/** Row of `RATING_MAX` stars, filled up to `value`. Pass `onChange` to make it
 *  clickable — used for both the read-only display and the editors. */
export function RatingStars({
  value,
  onChange,
  className
}: {
  value: number
  onChange?: (rating: number | undefined) => void
  className?: string
}): React.JSX.Element {
  const stars = Array.from({ length: RATING_MAX }, (_, i) => i + 1)
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {stars.map((n) => {
        const filled = n <= value
        const star = (
          <Star
            className={cn(
              'size-3.5',
              filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
            )}
          />
        )
        return onChange ? (
          <button
            key={n}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              // Clicking the currently-topmost filled star clears the rating,
              // the way toggling a checkbox off does.
              onChange(n === value ? undefined : n)
            }}
            className="cursor-pointer"
          >
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        )
      })}
    </span>
  )
}
