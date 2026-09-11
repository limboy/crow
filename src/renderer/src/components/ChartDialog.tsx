import { useEffect, useState } from 'react'
import type {
  ChartAggregate,
  ChartDateGrain,
  ChartSize,
  ChartSort,
  ChartSpec,
  ChartType,
  Field
} from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  CHART_AGGREGATES,
  CHART_DATE_GRAINS,
  CHART_SIZES,
  CHART_SORTS,
  CHART_TYPES,
  DEFAULT_CHART_LIMIT,
  canAggregate,
  canGroupBy,
  chartTitle,
  isDateGroupField
} from '@/lib/charts'
import { fieldTypeInfo } from '@/lib/fields'

/** Bucket counts offered in the picker. */
const LIMIT_OPTIONS = [4, 6, 8, 12, 20, 50]

/**
 * Create or edit one chart on a dashboard. Pass `chart` to edit; omit it to
 * create. Which controls appear follows from the choices above them — a metric
 * has nothing to group by, only a date grouping has a grain — so the form never
 * offers a setting that wouldn't do anything.
 */
export function ChartDialog({
  open,
  onOpenChange,
  chart,
  fields,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chart?: ChartSpec
  fields: Field[]
  onSubmit: (chart: ChartSpec) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<ChartSpec>(() => chart ?? blankChart())

  useEffect(() => {
    if (open) setDraft(chart ?? blankChart())
  }, [open, chart])

  const patch = (values: Partial<ChartSpec>): void => setDraft((prev) => ({ ...prev, ...values }))

  const groupFields = fields.filter(canGroupBy)
  const valueFields = fields.filter(canAggregate)
  const groupField = fields.find((f) => f.id === draft.groupByFieldId)
  const grouped = draft.type !== 'metric'
  const chronological = isDateGroupField(groupField)

  const handleSubmit = (): void => {
    onSubmit({
      ...draft,
      name: draft.name.trim(),
      // Settings that no longer apply are dropped rather than carried along
      // invisibly, so what's on disk matches what the chart draws.
      groupByFieldId: grouped ? draft.groupByFieldId : undefined,
      valueFieldId: draft.aggregate === 'count' ? undefined : draft.valueFieldId,
      dateGrain: grouped && chronological ? (draft.dateGrain ?? 'month') : undefined,
      sort: grouped && !chronological ? draft.sort : undefined,
      limit: grouped ? (draft.limit ?? DEFAULT_CHART_LIMIT) : undefined
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{chart ? 'Edit chart' : 'New chart'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chart-name">Title</Label>
            <Input
              id="chart-name"
              autoFocus
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder={chartTitle({ ...draft, name: '' }, fields)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Chart</Label>
            <Select
              items={Object.fromEntries(
                CHART_TYPES.map((info) => [
                  info.type,
                  <span key={info.type} className="flex items-center gap-1.5">
                    <info.icon className="size-4 text-muted-foreground" />
                    {info.label}
                  </span>
                ])
              )}
              value={draft.type}
              onValueChange={(v) => patch({ type: v as ChartType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_TYPES.map((info) => (
                  <SelectItem key={info.type} value={info.type}>
                    <span className="flex items-center gap-1.5">
                      <info.icon className="size-4 text-muted-foreground" />
                      {info.label}
                      <span className="text-xs text-muted-foreground">{info.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Measure</Label>
            <Select
              items={Object.fromEntries(CHART_AGGREGATES.map((info) => [info.key, info.label]))}
              value={draft.aggregate}
              onValueChange={(v) => patch({ aggregate: v as ChartAggregate })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHART_AGGREGATES.map((info) => (
                  <SelectItem key={info.key} value={info.key}>
                    {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.aggregate !== 'count' && (
            <FieldSelect
              label="Of field"
              fields={valueFields}
              value={draft.valueFieldId}
              placeholder={
                valueFields.length > 0 ? 'Pick a number field' : 'No number or rating fields yet'
              }
              onChange={(valueFieldId) => patch({ valueFieldId })}
            />
          )}

          {grouped && (
            <FieldSelect
              label="Group by"
              fields={groupFields}
              value={draft.groupByFieldId}
              placeholder="Pick a field"
              onChange={(groupByFieldId) => patch({ groupByFieldId })}
            />
          )}

          {grouped && chronological && (
            <div className="flex flex-col gap-1.5">
              <Label>Bucket by</Label>
              <Select
                items={Object.fromEntries(CHART_DATE_GRAINS.map((info) => [info.value, info.label]))}
                value={draft.dateGrain ?? 'month'}
                onValueChange={(v) => patch({ dateGrain: v as ChartDateGrain })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_DATE_GRAINS.map((info) => (
                    <SelectItem key={info.value} value={info.value}>
                      {info.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {grouped && !chronological && (
            <div className="flex flex-col gap-1.5">
              <Label>Order</Label>
              <Select
                items={Object.fromEntries(CHART_SORTS.map((info) => [info.value, info.label]))}
                value={draft.sort ?? 'valueDesc'}
                onValueChange={(v) => patch({ sort: v as ChartSort })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_SORTS.map((info) => (
                    <SelectItem key={info.value} value={info.value}>
                      {info.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex gap-3">
            {grouped && (
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Show at most</Label>
                <Select
                  items={Object.fromEntries(
                    LIMIT_OPTIONS.map((limit) => [String(limit), `${limit} groups`])
                  )}
                  value={String(draft.limit ?? DEFAULT_CHART_LIMIT)}
                  onValueChange={(v) => patch({ limit: Number(v) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIMIT_OPTIONS.map((limit) => (
                      <SelectItem key={limit} value={String(limit)}>
                        {limit} groups
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-1 flex-col gap-1.5">
              <Label>Width</Label>
              <Select
                items={Object.fromEntries(CHART_SIZES.map((info) => [info.value, info.label]))}
                value={draft.size ?? 'half'}
                onValueChange={(v) => patch({ size: v as ChartSize })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_SIZES.map((info) => (
                    <SelectItem key={info.value} value={info.value}>
                      {info.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{chart ? 'Save' : 'Add chart'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Base UI shows the trigger's placeholder for a value no item carries, which
 *  is how "not picked yet" is spelled here. */
const NO_FIELD = ''

function FieldSelect({
  label,
  fields,
  value,
  placeholder,
  onChange
}: {
  label: string
  fields: Field[]
  value: string | undefined
  placeholder: string
  onChange: (fieldId: string | undefined) => void
}): React.JSX.Element {
  const option = (field: Field): React.JSX.Element => {
    const Icon = fieldTypeInfo(field.type).icon
    return (
      <span className="flex items-center gap-1.5">
        <Icon className="size-4 text-muted-foreground" />
        {field.name}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        items={Object.fromEntries(fields.map((field) => [field.id, option(field)]))}
        value={fields.some((field) => field.id === value) ? value : NO_FIELD}
        onValueChange={(v) => onChange(v === NO_FIELD ? undefined : (v as string))}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {fields.map((field) => (
            <SelectItem key={field.id} value={field.id}>
              {option(field)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function blankChart(): ChartSpec {
  return { id: crypto.randomUUID(), name: '', type: 'column', aggregate: 'count' }
}
