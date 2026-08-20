import { ListFilter, Plus, X } from 'lucide-react'
import type { Field, FilterRule } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { fieldTypeInfo, operatorsFor, recordLabel } from '@/lib/fields'
import { useRelationTable } from '@/lib/relations'
import { ToolbarButton } from './ToolbarButton'

const uuid = (): string => crypto.randomUUID()

export function FilterPopover({
  fields,
  filters,
  onChange
}: {
  fields: Field[]
  filters: FilterRule[]
  onChange: (filters: FilterRule[]) => void
}): React.JSX.Element {
  const patchRule = (id: string, patch: Partial<FilterRule>): void => {
    onChange(filters.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))
  }

  const addRule = (): void => {
    const field = fields[0]
    if (!field) return
    onChange([
      ...filters,
      { id: uuid(), fieldId: field.id, operator: operatorsFor(field)[0].value, value: undefined }
    ])
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <ToolbarButton
            icon={ListFilter}
            label="Filter"
            count={filters.length > 0 ? filters.length : undefined}
            active={filters.length > 0}
          />
        }
      />
      <PopoverContent className="w-[440px] p-3" align="start">
        {filters.length === 0 ? (
          <p className="mb-2 text-sm text-muted-foreground">No filters applied.</p>
        ) : (
          <div className="mb-2 flex flex-col gap-1.5">
            {filters.map((rule) => (
              <FilterRuleRow
                key={rule.id}
                rule={rule}
                fields={fields}
                onPatch={(patch) => patchRule(rule.id, patch)}
                onRemove={() => onChange(filters.filter((r) => r.id !== rule.id))}
              />
            ))}
          </div>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={addRule}>
          <Plus data-slot="icon" />
          Add filter
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function FilterRuleRow({
  rule,
  fields,
  onPatch,
  onRemove
}: {
  rule: FilterRule
  fields: Field[]
  onPatch: (patch: Partial<FilterRule>) => void
  onRemove: () => void
}): React.JSX.Element | null {
  const field = fields.find((f) => f.id === rule.fieldId)
  if (!field) return null
  const operators = operatorsFor(field)
  const operator = operators.find((op) => op.value === rule.operator) ?? operators[0]

  const fieldItems = Object.fromEntries(
    fields.map((f) => {
      const info = fieldTypeInfo(f.type)
      return [
        f.id,
        <span key={f.id} className="flex items-center gap-1.5">
          <info.icon className="size-3.5 text-muted-foreground" />
          {f.name}
        </span>
      ]
    })
  )
  const operatorItems = Object.fromEntries(operators.map((op) => [op.value, op.label]))

  return (
    <div className="flex items-center gap-1.5">
      <Select
        items={fieldItems}
        value={field.id}
        onValueChange={(fieldId) => {
          const next = fields.find((f) => f.id === fieldId)
          if (!next) return
          onPatch({ fieldId: next.id, operator: operatorsFor(next)[0].value, value: undefined })
        }}
      >
        <SelectTrigger size="sm" className="w-32 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => {
            const info = fieldTypeInfo(f.type)
            return (
              <SelectItem key={f.id} value={f.id}>
                <info.icon className="size-3.5 text-muted-foreground" />
                {f.name}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>

      <Select
        items={operatorItems}
        value={operator.value}
        onValueChange={(op) => onPatch({ operator: op as FilterRule['operator'] })}
      >
        <SelectTrigger size="sm" className="w-36 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-0 flex-1">
        {operator.needsValue && (
          <FilterValueInput field={field} value={rule.value} onChange={(value) => onPatch({ value })} />
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  )
}

function FilterValueInput({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element | null {
  switch (field.type) {
    case 'select':
    case 'multiSelect': {
      const choices = field.options?.choices ?? []
      const choiceItems = Object.fromEntries(choices.map((c) => [c.id, c.name]))
      return (
        <Select
          items={choiceItems}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="Option…" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'relation':
      return <RelationFilterValue field={field} value={value} onChange={onChange} />
    case 'date':
      return (
        <Input
          type="date"
          className="h-8 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          className="h-8 text-sm"
          placeholder="Value"
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'checkbox':
    case 'image':
    case 'audio':
      return null
    default:
      return (
        <Input
          className="h-8 text-sm"
          placeholder="Value"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** Relation rules match on a linked record id, so the value is picked from
 *  the linked table rather than typed. */
function RelationFilterValue({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const target = useRelationTable(field)
  if (!target) {
    return <Input className="h-8 text-sm" disabled placeholder="Linked table missing" />
  }

  return (
    <Select
      items={Object.fromEntries(target.records.map((r) => [r.id, recordLabel(target, r)]))}
      value={typeof value === 'string' ? value : ''}
      onValueChange={(v) => onChange(v)}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder="Record…" />
      </SelectTrigger>
      <SelectContent>
        {target.records.map((record) => (
          <SelectItem key={record.id} value={record.id}>
            {recordLabel(target, record)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
