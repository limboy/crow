import { useMemo, useState } from 'react'
import { ChartColumn, ChevronDown, Plus, Table2 } from 'lucide-react'
import type { ChartSpec, Table, View } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ChartDialog } from '@/components/ChartDialog'
import { ChartFigure } from '@/components/charts/ChartFigure'
import { FilterPopover } from '@/components/toolbar/FilterPopover'
import { applyFilters } from '@/lib/derive'
import { chartMeasureLabel, chartTitle, chartTypeInfo } from '@/lib/charts'
import * as ops from '@/lib/ops'
import type { TableUpdater } from '@/lib/queries'
import { useProjectTables } from '@/lib/relations'
import { cn } from '@/lib/utils'

type DashboardViewType = Extract<View, { type: 'dashboard' }>

/**
 * Charts composed from the table's own records. Every chart on the view reads
 * the view's filtered slice, then applies its own optional filters.
 *
 * A dashboard doesn't sort or hide fields: it shows aggregates, not rows, and
 * each chart decides its own bucket order.
 */
export function DashboardView({
  table,
  view,
  update,
  onOpenRecord
}: {
  table: Table
  view: DashboardViewType
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}): React.JSX.Element {
  const config = view.config
  // Only read to bucket by a relation field, whose labels live in a sibling
  // table.
  const tables = useProjectTables()
  const [editing, setEditing] = useState<ChartSpec | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Every chart's own aggregation memo keys off this array, so it has to be
  // the same array between renders that didn't change the filters.
  const records = useMemo(
    () => applyFilters(table.records, config.filters, table.fields, config.filterMatch),
    [table.records, table.fields, config.filters, config.filterMatch]
  )

  const patchConfig = (patch: Partial<DashboardViewType['config']>): void => {
    update((t) =>
      ops.patchView(t, view.id, (v) =>
        v.type === 'dashboard' ? { ...v, config: { ...v.config, ...patch } } : v
      )
    )
  }

  const openNewChart = (): void => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openChart = (chart: ChartSpec): void => {
    setEditing(chart)
    setDialogOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* One filter row above everything it scopes, rather than a control per
          card — every chart re-renders against the same records. */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[13px] font-normal"
          onClick={openNewChart}
        >
          <Plus className="size-3.5 text-muted-foreground" />
          Add chart
        </Button>
        <FilterPopover
          fields={table.fields}
          filters={config.filters}
          match={config.filterMatch}
          onMatchChange={(filterMatch) => patchConfig({ filterMatch })}
          onChange={(filters) => patchConfig({ filters })}
        />
        <span className="ml-auto text-[13px] text-muted-foreground">
          {records.length.toLocaleString()} {records.length === 1 ? 'record' : 'records'}
          {records.length !== table.records.length &&
            ` of ${table.records.length.toLocaleString()}`}
        </span>
      </div>

      {config.charts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <ChartColumn className="size-8 text-muted-foreground/50" />
          <div>
            <p className="text-sm font-medium">Nothing charted yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Compose a dashboard from counts, sums and averages of this table.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={openNewChart}>
            <Plus data-slot="icon" />
            Add chart
          </Button>
        </div>
      ) : (
        <TooltipProvider delay={100}>
          <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 items-start gap-4 @min-[656px]:grid-cols-2">
              {config.charts.map((chart, index) => (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  table={table}
                  records={records}
                  tables={tables}
                  isFirst={index === 0}
                  isLast={index === config.charts.length - 1}
                  onOpenRecord={onOpenRecord}
                  onPatch={(patch) =>
                    update((t) =>
                      ops.patchView(t, view.id, (v) =>
                        v.type === 'dashboard'
                          ? {
                              ...v,
                              config: {
                                ...v.config,
                                charts: v.config.charts.map((c) =>
                                  c.id === chart.id ? { ...c, ...patch } : c
                                )
                              }
                            }
                          : v
                      )
                    )
                  }
                  onEdit={() => openChart(chart)}
                  onDuplicate={() => update((t) => ops.duplicateChart(t, view.id, chart.id))}
                  onMove={(offset) => update((t) => ops.moveChart(t, view.id, chart.id, offset))}
                  onDelete={() => update((t) => ops.deleteChart(t, view.id, chart.id))}
                />
              ))}
            </div>
          </div>
        </TooltipProvider>
      )}

      <ChartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chart={editing ?? undefined}
        fields={table.fields}
        onSubmit={(chart) =>
          update((t) =>
            editing ? ops.updateChart(t, view.id, chart) : ops.addChart(t, view.id, chart)
          )
        }
      />
    </div>
  )
}

function ChartCard({
  chart,
  table,
  records,
  tables,
  isFirst,
  isLast,
  onEdit,
  onPatch,
  onOpenRecord,
  onDuplicate,
  onMove,
  onDelete
}: {
  chart: ChartSpec
  table: Table
  records: Table['records']
  tables: Table[]
  isFirst: boolean
  isLast: boolean
  onEdit: () => void
  onPatch: (patch: Partial<ChartSpec>) => void
  onOpenRecord: (recordId: string) => void
  onDuplicate: () => void
  onMove: (offset: number) => void
  onDelete: () => void
}): React.JSX.Element {
  // Per-card and deliberately not saved: the table twin is a way to read the
  // chart you're looking at, not a second kind of tile.
  const [showTable, setShowTable] = useState(false)
  const Icon = chartTypeInfo(chart.type).icon
  const title = chartTitle(chart, table.fields)
  const measure = chartMeasureLabel(chart, table.fields)

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs',
        chart.size === 'full' && 'col-span-full'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-sm font-medium" title={title}>
              {title}
            </h3>
          </div>
          {chart.type !== 'metric' && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{measure}</p>
          )}
        </div>
        {chart.type !== 'metric' && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            title={showTable ? 'Show chart' : 'Show values as a table'}
            onClick={() => setShowTable((current) => !current)}
          >
            {showTable ? <Icon /> : <Table2 />}
            <span className="sr-only">{showTable ? 'Show chart' : 'Show values as a table'}</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground">
                <ChevronDown />
                <span className="sr-only">Chart options</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>Edit chart</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>Duplicate chart</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isFirst} onClick={() => onMove(-1)}>
              Move earlier
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={() => onMove(1)}>
              Move later
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              Delete chart
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center">
        <FilterPopover
          label="Chart filters"
          fields={table.fields}
          filters={chart.filters ?? []}
          match={chart.filterMatch ?? 'all'}
          onChange={(filters) => onPatch({ filters })}
          onMatchChange={(filterMatch) => onPatch({ filterMatch })}
        />
      </div>

      <ChartFigure
        spec={chart}
        table={table}
        onOpenRecord={onOpenRecord}
        records={records}
        tables={tables}
        showTable={showTable}
      />
    </div>
  )
}
