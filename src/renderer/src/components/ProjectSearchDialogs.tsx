import {
  CalendarDays,
  ChartColumn,
  GalleryVertical,
  SquareKanban,
  Table2,
  type LucideIcon
} from 'lucide-react'
import type { Project, ViewType } from '@shared/types'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'

const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: SquareKanban,
  gallery: GalleryVertical,
  calendar: CalendarDays,
  dashboard: ChartColumn
}

export function ProjectCommandPalette({
  open,
  onOpenChange,
  project,
  activeTableId,
  activeViewId,
  onSelectTable,
  onSelectView
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  activeTableId?: string
  activeViewId?: string
  onSelectTable: (tableId: string) => void
  onSelectView: (tableId: string, viewId: string) => void
}): React.JSX.Element {
  const select = (action: () => void): void => {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to table or view"
      description="Search the tables and views in this document."
      className="sm:max-w-lg"
    >
      <Command>
        <CommandInput autoFocus placeholder="Go to table or view…" />
        <CommandList>
          <CommandEmpty>No matching destination.</CommandEmpty>

          <CommandGroup heading={`Tables in ${project.name}`}>
            {project.tables.map((table) => (
              <CommandItem
                key={table.id}
                value={`table:${table.id}`}
                keywords={[table.name, project.name]}
                data-checked={table.id === activeTableId}
                onSelect={() => select(() => onSelectTable(table.id))}
              >
                <Table2 />
                <span className="truncate">{table.name}</span>
                <CommandShortcut>{project.name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={`Views in ${project.name}`}>
            {project.tables.flatMap((table) =>
              table.views.map((view) => {
                const Icon = VIEW_ICONS[view.type]
                return (
                  <CommandItem
                    key={`${table.id}:${view.id}`}
                    value={`view:${table.id}:${view.id}`}
                    keywords={[view.name, table.name, project.name]}
                    data-checked={table.id === activeTableId && view.id === activeViewId}
                    onSelect={() => select(() => onSelectView(table.id, view.id))}
                  >
                    <Icon />
                    <span className="truncate">{view.name}</span>
                    <CommandShortcut>{table.name}</CommandShortcut>
                  </CommandItem>
                )
              })
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
