import { ChevronDown } from 'lucide-react'
import type { Field, RecordRow, SummaryKey, Table } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { summaryOption, summaryOptions, summaryValue } from '@/lib/summary'
import { cn } from '@/lib/utils'

/**
 * The bar under the table: one footer cell per visible column, each showing a
 * statistic over the records the view currently displays and opening a menu to
 * pick which one.
 *
 * It lives outside the table's scroll container so it stays pinned to the
 * bottom however few rows there are; `scrollRef` is the element the table view
 * keeps horizontally in step with the grid.
 */
export function SummaryBar({
  fields,
  records,
  tables,
  summaries,
  columnWidth,
  gutterWidth,
  onChange,
  scrollRef
}: {
  fields: Field[]
  records: RecordRow[]
  tables: Table[]
  summaries: Record<string, SummaryKey> | undefined
  columnWidth: (fieldId: string) => number
  /** Width of the table's row-number column, which the bar has to line up with. */
  gutterWidth: number
  onChange: (fieldId: string, key: SummaryKey) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  return (
    <div
      ref={scrollRef}
      className="shrink-0 overflow-hidden border-t bg-muted/40 text-[13px]"
    >
      <div className="flex min-w-full">
        <div
          style={{ width: gutterWidth, minWidth: gutterWidth }}
          className="sticky left-0 z-[1] h-8 shrink-0 border-r bg-[color-mix(in_oklch,var(--muted)_40%,var(--background))]"
        />
        {fields.map((field) => (
          <SummaryCell
            key={field.id}
            field={field}
            records={records}
            tables={tables}
            value={summaries?.[field.id]}
            width={columnWidth(field.id)}
            onChange={(key) => onChange(field.id, key)}
          />
        ))}
        {/* Mirrors the grid's trailing add-field column so both scroll the same width. */}
        <div className="h-8 min-w-11 flex-1" />
      </div>
    </div>
  )
}

function SummaryCell({
  field,
  records,
  tables,
  value,
  width,
  onChange
}: {
  field: Field
  records: RecordRow[]
  tables: Table[]
  value: SummaryKey | undefined
  width: number
  onChange: (key: SummaryKey) => void
}): React.JSX.Element {
  const active = summaryOption(field, value)
  const text = summaryValue(field, value, records, tables)

  return (
    <div style={{ width, minWidth: width }} className="h-8 shrink-0 border-r">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              className="group flex h-full w-full items-center justify-end gap-1.5 px-2 transition-colors hover:bg-accent"
              title={active ? `${active.label}: ${text}` : 'Summary'}
            >
              {active ? (
                <>
                  <ChevronDown className="mr-auto size-3 shrink-0 rotate-180 opacity-0 transition-opacity group-hover:opacity-50" />
                  <span className="truncate text-xs text-muted-foreground">{active.short}</span>
                  <span className="truncate tabular-nums">{text}</span>
                </>
              ) : (
                <span className="flex items-center gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  <ChevronDown className="size-3 shrink-0 rotate-180" />
                  Summary
                </span>
              )}
            </button>
          }
        />
        <DropdownMenuContent align="end" side="top" className="w-auto min-w-40">
          <DropdownMenuRadioGroup
            value={value ?? 'none'}
            onValueChange={(next) => onChange(next as SummaryKey)}
          >
            {summaryOptions(field).map((option) => (
              <DropdownMenuRadioItem
                key={option.key}
                value={option.key}
                closeOnClick
                className={cn('mt-0.5 first:mt-0', option.key === 'none' && 'text-muted-foreground')}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
