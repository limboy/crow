import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Field, FieldType, SelectChoice } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
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
  CHOICE_COLOR_ORDER,
  CHOICE_DOT_CLASSES,
  FIELD_TYPES,
  nextChoiceColor
} from '@/lib/fields'
import { useProjectTables } from '@/lib/relations'
import { cn } from '@/lib/utils'

const uuid = (): string => crypto.randomUUID()

/**
 * Create or edit a field. Pass `field` to edit; omit it to create.
 * Calls onSubmit with the complete field definition.
 */
export function FieldDialog({
  open,
  onOpenChange,
  field,
  defaultType,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  field?: Field
  defaultType?: FieldType
  onSubmit: (field: Field) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const [choices, setChoices] = useState<SelectChoice[]>([])
  const [newChoice, setNewChoice] = useState('')
  const [relationTableId, setRelationTableId] = useState('')
  const [relationMultiple, setRelationMultiple] = useState(true)
  // A relation can point at any table in the project, including its own — a
  // task with sub-tasks, say.
  const tables = useProjectTables()

  useEffect(() => {
    if (open) {
      setName(field?.name ?? '')
      setType(field?.type ?? defaultType ?? 'text')
      setChoices(field?.options?.choices ?? [])
      setNewChoice('')
      setRelationTableId(field?.relation?.tableId ?? tables[0]?.id ?? '')
      setRelationMultiple(field?.relation?.multiple ?? true)
    }
  }, [open, field])

  const hasChoices = type === 'select' || type === 'multiSelect'
  const isRelation = type === 'relation'
  // The linked table is the one thing a relation can't do without; everything
  // else about a field has a sensible default.
  const canSubmit = name.trim() !== '' && (!isRelation || relationTableId !== '')

  const addChoice = (): void => {
    const trimmed = newChoice.trim()
    if (!trimmed) return
    setChoices((prev) => [...prev, { id: uuid(), name: trimmed, color: nextChoiceColor(prev) }])
    setNewChoice('')
  }

  const handleSubmit = (): void => {
    const trimmed = name.trim()
    if (!canSubmit) return
    onSubmit({
      id: field?.id ?? uuid(),
      name: trimmed,
      type,
      options: hasChoices ? { choices } : undefined,
      relation: isRelation ? { tableId: relationTableId, multiple: relationMultiple } : undefined
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'New field'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-name">Name</Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Field name"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select
              items={Object.fromEntries(
                FIELD_TYPES.map((info) => [
                  info.type,
                  <span key={info.type} className="flex items-center gap-1.5">
                    <info.icon className="size-4 text-muted-foreground" />
                    {info.label}
                  </span>
                ])
              )}
              value={type}
              onValueChange={(v) => setType(v as FieldType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((info) => (
                  <SelectItem key={info.type} value={info.type}>
                    <info.icon className="size-4 text-muted-foreground" />
                    {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isRelation && (
            <div className="flex flex-col gap-1.5">
              <Label>Linked table</Label>
              <Select
                items={Object.fromEntries(tables.map((t) => [t.id, t.name]))}
                value={relationTableId}
                onValueChange={(v) => setRelationTableId(v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a table" />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={relationMultiple}
                  onCheckedChange={(checked) => setRelationMultiple(checked === true)}
                />
                Allow linking multiple records
              </label>
            </div>
          )}

          {hasChoices && (
            <div className="flex flex-col gap-1.5">
              <Label>Options</Label>
              <div className="flex flex-col gap-1">
                {choices.map((choice) => (
                  <div key={choice.id} className="flex items-center gap-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="outline" size="icon" className="size-8 shrink-0">
                            <span
                              className={cn(
                                'size-3 rounded-full',
                                CHOICE_DOT_CLASSES[choice.color]
                              )}
                            />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start" className="grid grid-cols-5 gap-1 p-1.5">
                        {CHOICE_COLOR_ORDER.map((color) => (
                          <DropdownMenuItem
                            key={color}
                            className="size-7 justify-center p-0"
                            onClick={() =>
                              setChoices((prev) =>
                                prev.map((c) => (c.id === choice.id ? { ...c, color } : c))
                              )
                            }
                          >
                            <span className={cn('size-3.5 rounded-full', CHOICE_DOT_CLASSES[color])} />
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Input
                      className="h-8"
                      value={choice.name}
                      onChange={(e) =>
                        setChoices((prev) =>
                          prev.map((c) => (c.id === choice.id ? { ...c, name: e.target.value } : c))
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      onClick={() => setChoices((prev) => prev.filter((c) => c.id !== choice.id))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-8"
                    placeholder="Add an option…"
                    value={newChoice}
                    onChange={(e) => setNewChoice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addChoice()
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={addChoice}
                    disabled={!newChoice.trim()}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {field ? 'Save' : 'Create field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
