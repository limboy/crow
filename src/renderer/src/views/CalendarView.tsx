import { useEffect, useRef, useState } from 'react'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Image as ImageIcon, Plus } from 'lucide-react'
import {
  type Field,
  type ImageAspectRatio,
  type RecordRow,
  type Table,
  type View
} from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
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
import { ValueDisplay } from '@/components/ValueDisplay'
import { FieldsPopover } from '@/components/toolbar/FieldsPopover'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { GroupSelect } from '@/components/toolbar/GroupSelect'
import { ImageFieldSelect } from '@/components/toolbar/ImageFieldSelect'
import { SortPopover } from '@/components/toolbar/SortPopover'
import { applyFilters, applySorts } from '@/lib/derive'
import {
  cellValue,
  coverImageUrl,
  dateFormatInfo,
  displayValue,
  fieldDateParts,
  fieldTypeInfo,
  isComputedField,
  isCoverField,
  isEmptyValue
} from '@/lib/fields'
import { imageAspectRatioInfo } from '@/lib/imageAspect'
import { useProjectTables } from '@/lib/relations'
import * as ops from '@/lib/ops'
import type { TableUpdater } from '@/lib/queries'
import { cn } from '@/lib/utils'

type CalendarViewType = Extract<View, { type: 'calendar' }>
type CalendarMode = NonNullable<CalendarViewType['config']['mode']>

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEK_STARTS_ON = { weekStartsOn: 1 } as const

/** Field types a calendar can lay records out by. The two timestamp types are
 *  read-only, so records can be shown on the grid but not created onto a day. */
const DATE_SOURCE_TYPES: Field['type'][] = ['date', 'createdTime', 'lastModifiedTime']

/**
 * Text for an event's time chip — the wall-clock part of whatever field the
 * calendar lays records out by, written the way that field writes it.
 *
 * A `createdTime`/`lastModifiedTime` field set to a date-only format has no
 * time to show, so it gets no chip: the day cell already says which day it is.
 * Placement is unaffected either way — a record still sits at the minute it
 * was actually created.
 */
function eventTimeLabel(field: Field | undefined, time: string | undefined): string | undefined {
  if (!field || !time) return undefined
  if (isComputedField(field.type)) {
    return dateFormatInfo(field.dateFormat).hasTime ? time : undefined
  }
  // A `date` cell has no format of its own, so its time keeps the locale-ish
  // 12-hour reading it has always had.
  return format(new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))), 'h:mm a')
}

export function CalendarView({
  table,
  view,
  update,
  onOpenRecord
}: {
  table: Table
  view: CalendarViewType
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const config = view.config
  // Sorting by a relation field compares the labels of the linked records,
  // which live in a sibling table.
  const tables = useProjectTables()
  const dateFields = table.fields.filter((field) => field.type === 'date')
  const dateSources = table.fields.filter((field) => DATE_SOURCE_TYPES.includes(field.type))
  const dateSource =
    dateSources.find((field) => field.id === config.dateFieldId) ?? dateSources[0]
  // Only a real date field can be written to, so that's the only source a
  // click on an empty day can add a record onto.
  const canAddOnDay = dateSource?.type === 'date'
  const mode = config.mode ?? 'month'
  const showHours = config.showHours ?? true
  const imageFields = table.fields.filter(isCoverField)
  const imageField = imageFields.find((field) => field.id === config.imageFieldId)
  const cardFields = table.fields.filter(
    (field) =>
      !config.hiddenFieldIds.includes(field.id) &&
      field.id !== dateSource?.id &&
      field.id !== imageField?.id
  )

  const derived = applySorts(
    applyFilters(table.records, config.filters, table.fields, config.filterMatch),
    config.sorts,
    table.fields,
    tables
  )

  const patchConfig = (patch: Partial<CalendarViewType['config']>): void => {
    update((p) =>
      ops.patchView(p, view.id, (candidate) =>
        candidate.type === 'calendar'
          ? { ...candidate, config: { ...candidate.config, ...patch } }
          : candidate
      )
    )
  }

  const addRecordOn = (day: Date, timed = false): void => {
    if (!dateSource || !canAddOnDay) return
    update((p) => {
      const value = format(day, timed ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd')
      const next = ops.addRecord(p, { [dateSource.id]: value })
      const created = next.records[next.records.length - 1]
      onOpenRecord(created.id)
      return next
    })
  }

  const changeMode = (next: string): void => {
    if (next === 'month' || next === 'week' || next === 'day') patchConfig({ mode: next })
  }

  const moveBackward = (): void => {
    setAnchorDate((current) => {
      if (mode === 'month') return subMonths(current, 1)
      if (mode === 'week') return subWeeks(current, 1)
      return subDays(current, 1)
    })
  }

  const moveForward = (): void => {
    setAnchorDate((current) => {
      if (mode === 'month') return addMonths(current, 1)
      if (mode === 'week') return addWeeks(current, 1)
      return addDays(current, 1)
    })
  }

  const openDay = (day: Date): void => {
    setAnchorDate(day)
    patchConfig({ mode: 'day' })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <GroupSelect
          fields={dateSources}
          value={dateSource?.id}
          onChange={(dateFieldId) => patchConfig({ dateFieldId })}
          label="Date"
      icon={CalendarDays}
      allowNone={false}
    >
      {dateFields.length === 0 && (
        <>
          <DropdownMenuItem onClick={() => setAddFieldOpen(true)}>
            <Plus />
            Add date field
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuCheckboxItem
        checked={showHours}
        onCheckedChange={(checked) => patchConfig({ showHours: checked === true })}
      >
        Show hours
      </DropdownMenuCheckboxItem>
    </GroupSelect>
        {mode !== 'month' && !showHours && imageFields.length > 0 && (
          <ImageFieldSelect
            fields={imageFields}
            value={config.imageFieldId}
            aspectRatio={config.imageAspectRatio}
            onFieldChange={(imageFieldId) => patchConfig({ imageFieldId })}
            onAspectRatioChange={(imageAspectRatio) => patchConfig({ imageAspectRatio })}
          />
        )}
        {mode !== 'month' && (
          <FieldsPopover
            // The date source and cover image are shown by the card's own
            // chrome rather than as detail rows, so listing them here would
            // offer a checkbox that changes nothing.
            fields={table.fields.filter(
              (field) => field.id !== dateSource?.id && field.id !== imageField?.id
            )}
            hiddenFieldIds={config.hiddenFieldIds}
            onChange={(hiddenFieldIds) => patchConfig({ hiddenFieldIds })}
            lockedFieldId={table.fields[0]?.id}
          />
        )}
        <FilterPopover
          fields={table.fields}
          filters={config.filters}
          match={config.filterMatch}
          onMatchChange={(filterMatch) => patchConfig({ filterMatch })}
          onChange={(filters) => patchConfig({ filters })}
        />
        <SortPopover
          fields={table.fields}
          sorts={config.sorts}
          onChange={(sorts) => patchConfig({ sorts })}
        />

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center">
            <span className="text-sm tracking-tight">
              {formatRangeTitle(anchorDate, mode)}
            </span>
          </div>

          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList aria-label="Calendar range">
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1">
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
        </div>
      </div>

      <CalendarGrid
        anchorDate={anchorDate}
        mode={mode}
        showHours={showHours}
        records={derived}
        titleField={table.fields[0]}
        dateSource={dateSource}
        cardFields={cardFields}
        imageField={imageField}
        aspectRatio={config.imageAspectRatio}
        onOpenRecord={onOpenRecord}
        onOpenDay={openDay}
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
  showHours,
  records: allRecords,
  titleField,
  dateSource,
  cardFields,
  imageField,
  aspectRatio,
  onOpenRecord,
  onOpenDay,
  onAddRecord
}: {
  anchorDate: Date
  mode: CalendarMode
  showHours: boolean
  records: RecordRow[]
  titleField?: Field
  dateSource?: Field
  cardFields: Field[]
  imageField?: Field
  aspectRatio?: ImageAspectRatio
  onOpenRecord: (recordId: string) => void
  onOpenDay: (day: Date) => void
  onAddRecord?: (day: Date, timed?: boolean) => void
}): React.JSX.Element {
  const month = startOfMonth(anchorDate)
  const range = (() => {
    if (mode === 'month') {
      return {
        start: startOfWeek(month, WEEK_STARTS_ON),
        end: endOfWeek(endOfMonth(month), WEEK_STARTS_ON)
      }
    }
    if (mode === 'week') {
      return {
        start: startOfWeek(anchorDate, WEEK_STARTS_ON),
        end: endOfWeek(anchorDate, WEEK_STARTS_ON)
      }
    }
    return { start: anchorDate, end: anchorDate }
  })()
  const days = eachDayOfInterval(range)
  const recordsByDay = new Map<string, CalendarRecord[]>()

  for (const record of allRecords) {
    const parts = dateSource && fieldDateParts(dateSource, cellValue(dateSource, record))
    if (!parts) continue
    const records = recordsByDay.get(parts.date) ?? []
    records.push({ record, time: parts.time, timeLabel: eventTimeLabel(dateSource, parts.time) })
    recordsByDay.set(parts.date, records)
  }

  if (mode !== 'month' && showHours) {
    return (
      <HourAgenda
        days={days}
        recordsByDay={recordsByDay}
        titleField={titleField}
        cardFields={cardFields}
        onOpenRecord={onOpenRecord}
        onOpenDay={mode === 'week' ? onOpenDay : undefined}
        onAddRecord={onAddRecord}
      />
    )
  }

  return (
    <CalendarDayGrid
      days={days}
      month={month}
      compactRange={mode !== 'month'}
      recordsByDay={recordsByDay}
      titleField={titleField}
      cardFields={cardFields}
      imageField={imageField}
      aspectRatio={aspectRatio}
      onOpenRecord={onOpenRecord}
      onOpenDay={mode === 'day' ? undefined : onOpenDay}
      onAddRecord={onAddRecord}
    />
  )
}

interface CalendarRecord {
  record: RecordRow
  /** `HH:mm`, used to place the record on the hourly agenda. */
  time?: string
  /** What the time chip reads, or absent when the source shows no time. */
  timeLabel?: string
}

function CalendarDayGrid({
  days,
  month,
  compactRange,
  recordsByDay,
  titleField,
  cardFields,
  imageField,
  aspectRatio,
  onOpenRecord,
  onOpenDay,
  onAddRecord
}: {
  days: Date[]
  month: Date
  compactRange: boolean
  recordsByDay: Map<string, CalendarRecord[]>
  titleField?: Field
  cardFields: Field[]
  imageField?: Field
  aspectRatio?: ImageAspectRatio
  onOpenRecord: (recordId: string) => void
  onOpenDay?: (day: Date) => void
  onAddRecord?: (day: Date, timed?: boolean) => void
}): React.JSX.Element {
  const columnCount = days.length === 1 ? 1 : 7
  const rowCount = compactRange ? 1 : days.length / columnCount
  const gridRef = useRef<HTMLDivElement>(null)
  const visibleEventCapacity = useVisibleEventCapacity(gridRef, rowCount)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {days.length > 1 && (
        <div
          className="grid h-8 shrink-0 border-b bg-muted/30"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
        >
          {compactRange
            ? days.map((day) => {
                const today = isSameDay(day, new Date())
                return (
                  <div
                    key={format(day, 'yyyy-MM-dd')}
                    className="flex items-center justify-center gap-1 border-r text-[11px] font-medium text-muted-foreground last:border-r-0"
                  >
                    <span>{format(day, 'EEE')}</span>
                    {onOpenDay ? (
                      <Button
                        type="button"
                        variant={today ? 'default' : 'ghost'}
                        size="xs"
                        aria-label={`Open ${format(day, 'MMMM d, yyyy')} in Day view`}
                        onClick={() => onOpenDay(day)}
                      >
                        {format(day, 'd')}
                      </Button>
                    ) : (
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-md text-xs tabular-nums',
                          today && 'bg-primary font-semibold text-primary-foreground'
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                    )}
                  </div>
                )
              })
            : WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="flex items-center justify-center border-r text-[11px] font-medium text-muted-foreground last:border-r-0"
                >
                  {weekday}
                </div>
              ))}
        </div>
      )}
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))`
        }}
      >
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd')
          const records = recordsByDay.get(dateKey) ?? []
          const today = isSameDay(day, new Date())
          const inMonth = compactRange || isSameMonth(day, month)
          const hasMore = !compactRange && records.length > visibleEventCapacity
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
              {(!compactRange || onAddRecord) && (
                <div
                  className={cn(
                    'mb-1 flex h-7 shrink-0 items-center justify-between',
                    compactRange && 'justify-end'
                  )}
                >
                  {!compactRange &&
                    (onOpenDay ? (
                      <Button
                        type="button"
                        variant={today ? 'default' : 'ghost'}
                        size="icon-xs"
                        aria-label={`Open ${format(day, 'MMMM d, yyyy')} in Day view`}
                        className={cn(!inMonth && 'text-muted-foreground/60')}
                        onClick={() => onOpenDay(day)}
                      >
                        {format(day, 'd')}
                      </Button>
                    ) : (
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-md text-xs tabular-nums',
                          today && 'bg-primary font-semibold text-primary-foreground'
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                    ))}
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
              )}
              <div
                className={cn(
                  'flex min-h-0 flex-col gap-1',
                  compactRange ? 'overflow-y-auto' : 'overflow-hidden'
                )}
              >
                {visibleRecords.map((record) => (
                  <CalendarEventButton
                    key={record.record.id}
                    record={record.record}
                    timeLabel={record.timeLabel}
                    titleField={titleField}
                    cardFields={compactRange ? cardFields : undefined}
                    imageField={compactRange ? imageField : undefined}
                    aspectRatio={aspectRatio}
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

const HOUR_HEIGHT = 64
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function HourAgenda({
  days,
  recordsByDay,
  titleField,
  cardFields,
  onOpenRecord,
  onOpenDay,
  onAddRecord
}: {
  days: Date[]
  recordsByDay: Map<string, CalendarRecord[]>
  titleField?: Field
  cardFields: Field[]
  onOpenRecord: (recordId: string) => void
  onOpenDay?: (day: Date) => void
  onAddRecord?: (day: Date, timed?: boolean) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridTemplateColumns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_HEIGHT * 7.5
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {days.length > 1 && (
        <div
          className="grid shrink-0 border-b bg-muted/30"
          style={{ gridTemplateColumns }}
        >
          <div />
          {days.map((day) => {
            const today = isSameDay(day, new Date())
            return (
              <div
                key={format(day, 'yyyy-MM-dd')}
                className="flex h-12 items-center justify-center border-l"
              >
                {onOpenDay ? (
                  <Button
                    type="button"
                    variant={today ? 'secondary' : 'ghost'}
                    size="xs"
                    aria-label={`Open ${format(day, 'MMMM d, yyyy')} in Day view`}
                    onClick={() => onOpenDay(day)}
                  >
                    {format(day, 'EEE d')}
                  </Button>
                ) : (
                  <span className={cn('text-xs font-medium', today && 'text-primary')}>
                    {format(day, 'EEE d')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns }}>
        <div className="flex items-center justify-end pr-2 text-[10px] text-muted-foreground">
          All day
        </div>
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd')
          const records = (recordsByDay.get(dateKey) ?? []).filter((item) => !item.time)
          return (
            <div key={dateKey} className="group flex min-h-9 flex-col gap-1 border-l p-1">
              {records.map((item) => (
                <CalendarEventButton
                  key={item.record.id}
                  record={item.record}
                  titleField={titleField}
                  onOpenRecord={onOpenRecord}
                />
              ))}
              {onAddRecord && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Add all-day record on ${format(day, 'MMMM d, yyyy')}`}
                  className="self-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => onAddRecord(day)}
                >
                  <Plus />
                </Button>
              )}
            </div>
          )
        })}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid"
          style={{ height: HOUR_HEIGHT * 24, gridTemplateColumns }}
        >
          <div className="relative">
            {HOURS.slice(1).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {format(new Date(2000, 0, 1, hour), 'h a')}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd')
            const timed = (recordsByDay.get(dateKey) ?? []).filter(
              (item): item is CalendarRecord & { time: string } => item.time !== undefined
            )
            return (
              <WeekDayColumn
                key={dateKey}
                day={day}
                items={timed}
                titleField={titleField}
                cardFields={cardFields}
                onOpenRecord={onOpenRecord}
                onAddRecord={onAddRecord}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeekDayColumn({
  day,
  items,
  titleField,
  cardFields,
  onOpenRecord,
  onAddRecord
}: {
  day: Date
  items: (CalendarRecord & { time: string })[]
  titleField?: Field
  cardFields: Field[]
  onOpenRecord: (recordId: string) => void
  onAddRecord?: (day: Date, timed?: boolean) => void
}): React.JSX.Element {
  const [hoveredHour, setHoveredHour] = useState<number>()
  const positioned = layoutTimedEvents(items)
  const hoveredStart = new Date(day)
  if (hoveredHour !== undefined) hoveredStart.setHours(hoveredHour, 0, 0, 0)

  const updateHoveredHour = (event: React.MouseEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const offset = Math.max(0, Math.min(bounds.height - 1, event.clientY - bounds.top))
    setHoveredHour(Math.floor(offset / HOUR_HEIGHT))
  }

  return (
    <div
      className="relative border-l"
      onMouseMove={updateHoveredHour}
      onMouseLeave={() => setHoveredHour(undefined)}
    >
      {HOURS.slice(1).map((hour) => (
        <div
          key={hour}
          aria-hidden="true"
          className="absolute left-0 right-0 border-t"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
      {positioned.map(({ item, column, columnCount, minute }) => (
        <TimedEventButton
          key={item.record.id}
          item={item}
          minute={minute}
          column={column}
          columnCount={columnCount}
          titleField={titleField}
          cardFields={cardFields}
          onOpenRecord={onOpenRecord}
        />
      ))}
      {onAddRecord && hoveredHour !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Add record on ${format(hoveredStart, 'MMMM d, yyyy')} at ${format(hoveredStart, 'h a')}`}
          className="absolute right-0"
          style={{ top: hoveredHour * HOUR_HEIGHT + 2 }}
          onClick={(event) => {
            event.stopPropagation()
            onAddRecord(hoveredStart, true)
          }}
        >
          <Plus />
        </Button>
      )}
      {isSameDay(day, new Date()) && <CurrentTimeLine />}
    </div>
  )
}

function timeToMinute(time: string): number {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function layoutTimedEvents(items: (CalendarRecord & { time: string })[]): Array<{
  item: CalendarRecord & { time: string }
  minute: number
  column: number
  columnCount: number
}> {
  const sorted = [...items].sort((a, b) => a.time.localeCompare(b.time))
  const result: Array<{
    item: CalendarRecord & { time: string }
    minute: number
    column: number
    columnCount: number
  }> = []
  let index = 0

  while (index < sorted.length) {
    const cluster: (CalendarRecord & { time: string })[] = [sorted[index]]
    let clusterEnd = timeToMinute(sorted[index].time) + 60
    index += 1
    while (index < sorted.length && timeToMinute(sorted[index].time) < clusterEnd) {
      cluster.push(sorted[index])
      clusterEnd = Math.max(clusterEnd, timeToMinute(sorted[index].time) + 60)
      index += 1
    }
    const columnEnds: number[] = []
    const placed = cluster.map((item) => {
      const minute = timeToMinute(item.time)
      let column = columnEnds.findIndex((end) => end <= minute)
      if (column === -1) column = columnEnds.length
      columnEnds[column] = minute + 60
      return { item, minute, column }
    })
    result.push(...placed.map((placedItem) => ({ ...placedItem, columnCount: columnEnds.length })))
  }
  return result
}

function TimedEventButton({
  item,
  minute,
  column,
  columnCount,
  titleField,
  cardFields,
  onOpenRecord
}: {
  item: CalendarRecord & { time: string }
  minute: number
  column: number
  columnCount: number
  titleField?: Field
  cardFields: Field[]
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const tables = useProjectTables()
  const title = titleField ? displayValue(titleField, cellValue(titleField, item.record), tables) : ''
  const details = cardFields
    .filter(
      (field) =>
        field.id !== titleField?.id && !isEmptyValue(field, cellValue(field, item.record))
    )
    .map((field) => displayValue(field, cellValue(field, item.record), tables))
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      className="absolute overflow-hidden rounded-md border bg-secondary px-1.5 py-1 text-left text-secondary-foreground shadow-xs hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        top: (minute / 60) * HOUR_HEIGHT + 1,
        height: Math.min(HOUR_HEIGHT - 2, HOUR_HEIGHT * 24 - (minute / 60) * HOUR_HEIGHT - 2),
        left: `calc(${(column / columnCount) * 100}% + 2px)`,
        width: `calc(${100 / columnCount}% - 4px)`
      }}
      onClick={() => onOpenRecord(item.record.id)}
    >
      <span className="block truncate text-[11px] font-semibold">{title || 'Untitled'}</span>
      <span className="block truncate text-[10px] tabular-nums text-muted-foreground">
        {[item.timeLabel, details].filter(Boolean).join(' · ')}
      </span>
    </button>
  )
}

function CurrentTimeLine(): React.JSX.Element {
  const now = new Date()
  const minute = now.getHours() * 60 + now.getMinutes()
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 right-0 border-t border-primary"
      style={{ top: (minute / 60) * HOUR_HEIGHT }}
    >
      <span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary" />
    </div>
  )
}

function CalendarEventButton({
  record,
  timeLabel,
  titleField,
  cardFields,
  imageField,
  aspectRatio,
  onOpenRecord
}: {
  record: RecordRow
  timeLabel?: string
  titleField?: Field
  cardFields?: Field[]
  imageField?: Field
  aspectRatio?: ImageAspectRatio
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const tables = useProjectTables()
  const title = titleField ? displayValue(titleField, cellValue(titleField, record), tables) : ''
  const detailFields = cardFields?.filter(
    (field) => field.id !== titleField?.id && !isEmptyValue(field, cellValue(field, record))
  )
  // A video field features the still captured from it, so this is an image
  // url either way — or nothing, for a video with no cover captured yet.
  const imageUrl = imageField ? coverImageUrl(imageField, record.values[imageField.id]) : undefined
  const ImagePlaceholderIcon = imageField ? fieldTypeInfo(imageField.type).icon : ImageIcon

  if (cardFields) {
    return (
      <div
        role="button"
        tabIndex={0}
        className="shrink-0 overflow-hidden rounded-md border bg-card text-left shadow-xs outline-none transition-shadow hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpenRecord(record.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpenRecord(record.id)
        }}
      >
        {imageField && (
          <div
            className={cn(
              'flex items-center justify-center border-b bg-muted/60',
              imageAspectRatioInfo(aspectRatio).className
            )}
          >
            {imageUrl ? (
              <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlaceholderIcon className="size-5 text-muted-foreground/40" />
            )}
          </div>
        )}
        <div className="p-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-[13px] font-medium',
                !title && 'text-muted-foreground'
              )}
            >
              {title || 'Untitled'}
            </span>
            {timeLabel && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {timeLabel}
              </span>
            )}
          </div>
          {detailFields && detailFields.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {detailFields.map((field) => (
                <div key={field.id} className="flex min-w-0 text-xs text-muted-foreground">
                  <ValueDisplay
                    field={field}
                    value={cellValue(field, record)}
                    className="max-w-full"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <Button
      variant="secondary"
      size="xs"
      className="w-full shrink-0 justify-start"
      onClick={() => onOpenRecord(record.id)}
    >
      <span className="truncate">{title || 'Untitled'}</span>
      {timeLabel && (
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {timeLabel}
        </span>
      )}
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
  records: CalendarRecord[]
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
          {records.map((item) => (
            <CalendarEventButton
              key={item.record.id}
              record={item.record}
              timeLabel={item.timeLabel}
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
  if (mode === 'day') return format(anchorDate, 'EEEE, MMMM d, yyyy')

  const start = startOfWeek(anchorDate, WEEK_STARTS_ON)
  const end = endOfWeek(anchorDate, WEEK_STARTS_ON)
  if (start.getFullYear() !== end.getFullYear()) {
    return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
  }
  return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
}
