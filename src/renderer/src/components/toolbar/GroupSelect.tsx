import { Rows3 } from 'lucide-react'
import type { Field } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { fieldTypeInfo } from '@/lib/fields'
import { ToolbarButton } from './ToolbarButton'

const NONE_VALUE = '__none__'

/** Toolbar dropdown for choosing which field to group / bucket records by. */
export function GroupSelect({
  fields,
  value,
  onChange,
  label = 'Group',
  icon = Rows3,
  noneLabel = 'No grouping',
  allowNone = true
}: {
  fields: Field[]
  value?: string
  onChange: (fieldId: string | undefined) => void
  label?: string
  icon?: typeof Rows3
  noneLabel?: string
  allowNone?: boolean
}): React.JSX.Element {
  const active = fields.find((f) => f.id === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            icon={icon}
            label={active ? `${label}: ${active.name}` : label}
            active={active !== undefined}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={active?.id ?? NONE_VALUE}
          onValueChange={(next) => onChange(next === NONE_VALUE ? undefined : (next as string))}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {label} by
            </DropdownMenuLabel>
            {fields.map((field) => {
              const info = fieldTypeInfo(field.type)
              return (
                <DropdownMenuRadioItem key={field.id} value={field.id} closeOnClick>
                  <info.icon className="size-3.5 text-muted-foreground" />
                  {field.name}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuGroup>
          {allowNone && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem
                value={NONE_VALUE}
                closeOnClick
                className="text-muted-foreground"
              >
                {noneLabel}
              </DropdownMenuRadioItem>
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
