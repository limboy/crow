import type { Field } from '@shared/types'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { linkedRecordIds, recordLabel } from '@/lib/fields'
import { useRelationTable } from '@/lib/relations'

/**
 * Popover body for linking records from another table. The cell always holds
 * an array of record ids from that table; a single-link field just caps it at
 * one, and closes as soon as you pick.
 */
export function RelationEditor({
  field,
  value,
  onChange,
  onDone
}: {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
  onDone?: () => void
}): React.JSX.Element {
  const target = useRelationTable(field)
  const multi = field.relation?.multiple === true
  const selectedIds = linkedRecordIds(value)

  if (!target) {
    return (
      <p className="p-3 text-sm text-muted-foreground">
        The linked table no longer exists. Edit the field to point it at another one.
      </p>
    )
  }

  const toggle = (recordId: string): void => {
    if (multi) {
      onChange(
        selectedIds.includes(recordId)
          ? selectedIds.filter((id) => id !== recordId)
          : [...selectedIds, recordId]
      )
    } else {
      onChange(selectedIds.includes(recordId) ? [] : [recordId])
      onDone?.()
    }
  }

  return (
    // Same no-initial-highlight trick as SelectEditor: cmdk would otherwise
    // highlight an arbitrary row on open.
    <Command defaultValue="__no_initial_highlight__">
      <CommandInput placeholder={`Search ${target.name}…`} />
      <CommandList>
        <CommandEmpty>
          {target.records.length === 0 ? `${target.name} has no records yet.` : 'No records found.'}
        </CommandEmpty>
        <CommandGroup>
          {target.records.map((record) => (
            <CommandItem
              key={record.id}
              // Labels repeat (two blank rows both read "Untitled"), and cmdk
              // keys items by value — the id keeps them distinct.
              value={`${recordLabel(target, record)} ${record.id}`}
              data-checked={selectedIds.includes(record.id)}
              onSelect={() => toggle(record.id)}
            >
              <span className="truncate">{recordLabel(target, record)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {selectedIds.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__clear__"
                className="text-muted-foreground"
                onSelect={() => {
                  onChange([])
                  onDone?.()
                }}
              >
                Clear {multi ? 'links' : 'link'}
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}
