import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { dateValueParts } from '@/lib/fields'

export function DateEditor({
  value,
  onChange,
  onDone
}: {
  value: unknown
  onChange: (value: unknown) => void
  onDone?: () => void
}): React.JSX.Element {
  const parts = dateValueParts(value)
  const selected = parts ? new Date(`${parts.date}T00:00:00`) : undefined

  const setDate = (date: Date | undefined): void => {
    if (!date) {
      onChange(undefined)
      return
    }
    const day = format(date, 'yyyy-MM-dd')
    onChange(parts?.time ? `${day}T${parts.time}` : day)
  }

  const setTime = (time: string): void => {
    if (!parts) return
    onChange(time ? `${parts.date}T${time}` : parts.date)
  }

  return (
    <div>
      <Calendar
        mode="single"
        selected={selected}
        defaultMonth={selected}
        onSelect={setDate}
      />
      <div className="flex items-center gap-2 border-t p-2">
        <Input
          type="time"
          aria-label="Event time"
          value={parts?.time ?? ''}
          disabled={!parts}
          onChange={(event) => setTime(event.target.value)}
        />
        {parts?.time && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setTime('')}
          >
            All day
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onChange(undefined)}
        >
          Clear
        </Button>
        {onDone && (
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  )
}
