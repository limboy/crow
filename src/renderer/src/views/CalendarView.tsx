import { useEffect, useRef, useState } from 'react'
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getWeek,
  isValid,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  CREATED_AT_DATE_SOURCE,
  type Field,
  type Project,
  type RecordRow,
  type View
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FieldDialog } from '@/components/FieldDialog'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { displayValue } from '@/lib/fields'
import * as ops from '@/lib/ops'
import type { ProjectUpdater } from '@/lib/queries'
import { cn } from '@/lib/utils'

type CalendarViewType = Extract<View, { type: 'calendar' }>
type CalendarMode = NonNullable<CalendarViewType['config']['mode']>

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CREATED_DATE_SOURCE: Field = {
  id: CREATED_AT_DATE_SOURCE,
  name: 'Created',
  type: 'date'
}

export function CalendarView({
  project,
  view,
  update,
  onOpenRecord
}: {
  project: Project
  view: CalendarViewType
  update: ProjectUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const dateFields = project.fields.filter((field) => field.type === 'date')
  const dateSources = [CREATED_DATE_SOURCE, ...dateFields]
  const dateSource =
    dateSources.find((field) => field.id === view.config.dateFieldId) ?? CREATED_DATE_SOURCE
  const canAddOnDay = dateSource.id !== CREATED_AT_DATE_SOURCE
  const mode = view.config.mode ?? 'month'

  const patchConfig = (patch: Partial<CalendarViewType['config']>): void => {
    update((p) =>
      ops.patchView(p, view.id, (candidate) =>
        candidate.type === 'calendar'
          ? { ...candidate, config: { ...candidate.config, ...patch } }
          : candidate
      )
    )
  }

  const addRecordOn = (day: Date): void => {
    if (!canAddOnDay) return
    update((p) => {
      const next = ops.addRecord(p, { [dateSource.id]: format(day, 'yyyy-MM-dd') })
      const created = next.records[next.records.length - 1]
      onOpenRecord(created.id)
      return next
    })
  }

  const changeMode = (next: string): void => {
    if (next === 'month' || next === 'week') patchConfig({ mode: next })
  }

  const moveBackward = (): void => {
    setAnchorDate((current) => (mode === 'month' ? subMonths(current, 1) : subWeeks(current, 1)))
  }

  const moveForward = (): void => {
    setAnchorDate((current) => (mode === 'month' ? addMonths(current, 1) : addWeeks(current, 1)))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <GroupSelect
          fields={dateSources}
          value={dateSource.id}
          onChange={(dateFieldId) => patchConfig({ dateFieldId })}
          label="Date"
          icon={CalendarDays}
          allowNone={false}
        />
        {dateFields.length === 0 && (
          <Button variant="ghost" size="xs" onClick={() => setAddFieldOpen(true)}>
            <Plus data-icon="inline-start" />
            Add date field
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Tabs
            value={mode}
            onValueChange={changeMode}
          >
            <TabsList aria-label="Calendar range">
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="gap-1 items-center flex">
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Previous ${mode}`}
            onClick={moveBackward}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="xs" onClick={() => setAnchorDate(new Date())}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            aria-label={`Next ${mode}`}
            onClick={moveForward}
          >
            <ChevronRight />
          </Button>
          </div>
          <div className="flex min-w-40 items-center justify-end gap-2">
            {/*{mode === 'week' && <Badge variant="secondary">W{getWeek(anchorDate)}</Badge>}*/}
            <span className="text-right text-sm font-semibold tracking-tight">
              {formatRangeTitle(anchorDate, mode)}
            </span>
          </div>
        </div>
      </div>

      <CalendarGrid
        anchorDate={anchorDate}
        mode={mode}
        project={project}
        dateSourceId={dateSource.id}
        onOpenRecord={onOpenRecord}
        onAddRecord={canAddOnDay ? addRecordOn : undefined}
      />

      <FieldDialog
        open={addFieldOpen}
        onOpenChange={setAddFieldOpen}
        defaultType="date"
        onSubmit={(field) =>
          update((p) => {
            const next = ops.addField(p, field)
            return field.type === 'date'
              ? ops.patchView(next, view.id, (candidate) =>
                  candidate.type === 'calendar'
                    ? { ...candidate, config: { ...candidate.config, dateFieldId: field.id } }
                    : candidate
                )
              : next
          })
        }
      />
    </div>
  )
}

function CalendarGrid({
  anchorDate,
  mode,
  project,
  dateSourceId,
  onOpenRecord,
  onAddRecord
}: {
  anchorDate: Date
  mode: CalendarMode
  project: Project
  dateSourceId: string
  onOpenRecord: (recordId: string) => void
  onAddRecord?: (day: Date) => void
}): React.JSX.Element {
  const titleField = project.fields[0]
  const month = startOfMonth(anchorDate)
  const range =
    mode === 'month'
      ? { start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) }
      : { start: startOfWeek(anchorDate), end: endOfWeek(anchorDate) }
  const days = eachDayOfInterval(range)
  const rowCount = days.length / 7
  const gridRef = useRef<HTMLDivElement>(null)
  const visibleEventCapacity = useVisibleEventCapacity(gridRef, rowCount)
  const recordsByDay = new Map<string, RecordRow[]>()

  for (const record of project.records) {
    const createdDate = new Date(record.createdAt)
    const value =
      dateSourceId === CREATED_AT_DATE_SOURCE && isValid(createdDate)
        ? format(createdDate, 'yyyy-MM-dd')
        : record.values[dateSourceId]
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue
    const records = recordsByDay.get(value) ?? []
    records.push(record)
    recordsByDay.set(value, records)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-8 shrink-0 grid-cols-7 border-b bg-muted/30">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="flex items-center justify-center border-r text-[11px] font-medium text-muted-foreground last:border-r-0"
          >
            {weekday}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
      >
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd')
          const records = recordsByDay.get(dateKey) ?? []
          const today = isSameDay(day, new Date())
          const inMonth = mode === 'week' || isSameMonth(day, month)
          const hasMore = records.length > visibleEventCapacity
          const visibleRecords = hasMore
            ? records.slice(0, Math.max(0, visibleEventCapacity - 1))
            : records

          return (
            <div
              key={dateKey}
              className={cn(
                'group flex min-h-0 flex-col border-b border-r p-1.5 last:border-r-0',
                !inMonth && 'bg-muted/20'
              )}
            >
              <div className="mb-1 flex h-6 shrink-0 items-center justify-between">
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                    !inMonth && 'text-muted-foreground/60',
                    today && 'bg-primary font-semibold text-primary-foreground'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {onAddRecord && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Add record on ${format(day, 'MMMM d, yyyy')}`}
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    onClick={() => onAddRecord(day)}
                  >
                    <Plus />
                  </Button>
                )}
              </div>
              <div className="flex min-h-0 flex-col gap-1 overflow-hidden">
                {visibleRecords.map((record) => (
                  <CalendarEventButton
                    key={record.id}
                    record={record}
                    titleField={titleField}
                    onOpenRecord={onOpenRecord}
                  />
                ))}
                {hasMore && (
                  <MoreEventsPopover
                    day={day}
                    records={records}
                    hiddenCount={records.length - visibleRecords.length}
                    titleField={titleField}
                    onOpenRecord={onOpenRecord}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CalendarEventButton({
  record,
  titleField,
  onOpenRecord
}: {
  record: RecordRow
  titleField?: Field
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const title = titleField ? displayValue(titleField, record.values[titleField.id]) : ''

  return (
    <Button
      variant="secondary"
      size="xs"
      className="w-full shrink-0 justify-start"
      onClick={() => onOpenRecord(record.id)}
    >
      <span className="truncate">{title || 'Untitled'}</span>
    </Button>
  )
}

function MoreEventsPopover({
  day,
  records,
  hiddenCount,
  titleField,
  onOpenRecord
}: {
  day: Date
  records: RecordRow[]
  hiddenCount: number
  titleField?: Field
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="w-full shrink-0 justify-start" />
        }
      >
        +{hiddenCount} more
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{format(day, 'EEEE, MMMM d')}</PopoverTitle>
          <PopoverDescription>
            {records.length} record{records.length === 1 ? '' : 's'}
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {records.map((record) => (
            <CalendarEventButton
              key={record.id}
              record={record}
              titleField={titleField}
              onOpenRecord={onOpenRecord}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function useVisibleEventCapacity(
  gridRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number
): number {
  const [capacity, setCapacity] = useState(2)

  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return

    const measure = (): void => {
      const rowHeight = grid.clientHeight / rowCount
      setCapacity(Math.max(1, Math.floor((rowHeight - 36) / 28)))
    }

    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    measure()
    return () => observer.disconnect()
  }, [gridRef, rowCount])

  return capacity
}

function formatRangeTitle(anchorDate: Date, mode: CalendarMode): string {
  if (mode === 'month') return format(anchorDate, 'MMMM yyyy')

  const start = startOfWeek(anchorDate)
  const end = endOfWeek(anchorDate)
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
  }
  return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
}
