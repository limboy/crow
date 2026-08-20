import { useState } from 'react'
import { CalendarIcon, ChevronsUpDown } from 'lucide-react'
import type { Field } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { choiceById, choicesByIds, displayValue, linkedRecords, recordLabel } from '@/lib/fields'
import { useProjectTables, useRelationTable } from '@/lib/relations'
import { ChoiceBadge } from '@/components/ChoiceBadge'
import { RecordBadge } from '@/components/RecordBadge'
import { AudioEditor } from './AudioEditor'
import { DateEditor } from './DateEditor'
import { ImageEditor } from './ImageEditor'
import { RelationEditor } from './RelationEditor'
import { SelectEditor } from './SelectEditor'

/** Full-size editor for one field value, used in the record detail sheet. */
export function ValueEditor({
  projectId,
  field,
  value,
  onChange
}: {
  projectId: string
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  switch (field.type) {
    case 'text':
      return (
        <Textarea
          rows={1}
          className="min-h-9 resize-none py-2"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Empty"
        />
      )
    case 'url':
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://"
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          placeholder="Empty"
        />
      )
    case 'checkbox':
      return (
        <div className="flex h-9 items-center">
          <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
        </div>
      )
    case 'date':
      return <DateValueEditor field={field} value={value} onChange={onChange} />
    case 'select':
    case 'multiSelect':
      return <SelectValueEditor field={field} value={value} onChange={onChange} />
    case 'relation':
      return <RelationValueEditor field={field} value={value} onChange={onChange} />
    case 'image':
      return <ImageEditor projectId={projectId} value={value} onChange={onChange} />
    case 'audio':
      return <AudioEditor projectId={projectId} value={value} onChange={onChange} />
  }
}

function DateValueEditor({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const text = displayValue(field, value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-start font-normal">
            <CalendarIcon data-slot="icon" className="text-muted-foreground" />
            {text || <span className="text-muted-foreground">Pick a date</span>}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <DateEditor value={value} onChange={onChange} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function RelationValueEditor({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const tables = useProjectTables()
  const target = useRelationTable(field)
  const records = linkedRecords(field, value, tables)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="min-h-9 w-full justify-between font-normal">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {target === undefined ? (
                <span className="text-muted-foreground">Linked table missing</span>
              ) : records.length > 0 ? (
                records.map((record) => (
                  <RecordBadge key={record.id} label={recordLabel(target, record)} />
                ))
              ) : (
                <span className="text-muted-foreground">
                  {field.relation?.multiple ? 'Link records' : 'Link a record'}
                </span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <RelationEditor
          field={field}
          value={value}
          onChange={onChange}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function SelectValueEditor({
  field,
  value,
  onChange
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const multi = field.type === 'multiSelect'
  const selected = multi ? choicesByIds(field, value) : []
  const single = multi ? undefined : choiceById(field, value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="min-h-9 w-full justify-between font-normal">
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              {multi ? (
                selected.length > 0 ? (
                  selected.map((choice) => <ChoiceBadge key={choice.id} choice={choice} />)
                ) : (
                  <span className="text-muted-foreground">Select options</span>
                )
              ) : single ? (
                <ChoiceBadge choice={single} />
              ) : (
                <span className="text-muted-foreground">Select an option</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-64 p-0" align="start">
        <SelectEditor
          field={field}
          value={value}
          multi={multi}
          onChange={onChange}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
