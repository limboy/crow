import { Image as ImageIcon } from 'lucide-react'
import type { Field, ImageAspectRatio } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { fieldTypeInfo } from '@/lib/fields'
import { IMAGE_ASPECT_RATIO_OPTIONS, imageAspectRatioInfo } from '@/lib/imageAspect'
import { ToolbarButton } from './ToolbarButton'

const NONE_VALUE = '__none__'

/** Toolbar dropdown for picking a card's featured image field and, once one
 *  is chosen, the aspect ratio it renders at (nested as a submenu) — shared
 *  by Kanban, Gallery and Calendar. */
export function ImageFieldSelect({
  fields,
  value,
  aspectRatio,
  onFieldChange,
  onAspectRatioChange,
  label = 'Image',
  noneLabel = 'No card image'
}: {
  fields: Field[]
  value?: string
  aspectRatio?: ImageAspectRatio
  onFieldChange: (fieldId: string | undefined) => void
  onAspectRatioChange: (ratio: ImageAspectRatio) => void
  label?: string
  noneLabel?: string
}): React.JSX.Element {
  const active = fields.find((f) => f.id === value)
  const activeRatio = imageAspectRatioInfo(aspectRatio)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            icon={ImageIcon}
            label={active ? `${label}: ${active.name}` : label}
            active={active !== undefined}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup
          value={active?.id ?? NONE_VALUE}
          onValueChange={(next) =>
            onFieldChange(next === NONE_VALUE ? undefined : (next as string))
          }
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
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem
            value={NONE_VALUE}
            closeOnClick
            className="text-muted-foreground"
          >
            {noneLabel}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <activeRatio.icon className="size-3.5 text-muted-foreground" />
                Ratio: {activeRatio.value}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={activeRatio.value}
                  onValueChange={(next) => onAspectRatioChange(next as ImageAspectRatio)}
                >
                  {IMAGE_ASPECT_RATIO_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                      <option.icon className="size-3.5 text-muted-foreground" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
