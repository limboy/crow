import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CalendarDays,
  ChevronDown,
  GalleryVertical,
  Plus,
  SquareKanban,
  Table2,
  type LucideIcon
} from 'lucide-react'
import type { Project, Table, View, ViewType } from '@shared/types'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { PageHeader } from '@/components/PageHeader'
import { RecordSheet } from '@/components/RecordSheet'
import { TableView } from '@/views/TableView'
import { KanbanView } from '@/views/KanbanView'
import { GalleryView } from '@/views/GalleryView'
import { CalendarView } from '@/views/CalendarView'
import * as ops from '@/lib/ops'
import { applyFilters } from '@/lib/derive'
import { ProjectTablesContext } from '@/lib/relations'
import {
  useProject,
  useProjects,
  useUpdateProject,
  useUpdateTable,
  type ProjectUpdater,
  type TableUpdater
} from '@/lib/queries'
import { cn } from '@/lib/utils'

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: SquareKanban,
  gallery: GalleryVertical,
  calendar: CalendarDays
}

export interface ViewProps {
  projectId: string
  table: Table
  view: View
  update: TableUpdater
  onOpenRecord: (recordId: string) => void
}

export default function ProjectPage(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: project, isLoading, isError } = useProject(id)
  const { data: projects, isLoading: isLoadingProjects } = useProjects()
  const updateProject = useUpdateProject(id)

  const [activeTableId, setActiveTableId] = useState<string>()
  // Remembered per table, so switching tables and coming back lands on the
  // view you left rather than resetting to the first one.
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>({})
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)

  // A project can disappear out from under this route (deleted elsewhere,
  // data folder switched to one that doesn't have it, stale link, etc).
  // react-query keeps the last-successful `project` around even once a
  // refetch errors, so isError — not just a missing `project` — is what
  // tells us it's actually gone. Once we're sure, fall back to another
  // project instead of leaving the user stranded on a dead route.
  useEffect(() => {
    if (isLoading || isLoadingProjects || (project && !isError) || !projects) return
    const next = projects.find((p) => p.id !== id) ?? projects[0]
    navigate(next ? `/project/${next.id}` : '/', { replace: true })
  }, [isLoading, isLoadingProjects, project, isError, projects, id, navigate])

  // A table/view id left over from another project (or one deleted elsewhere)
  // simply falls back to the first, so the page always has something to show.
  const tables = project?.tables ?? []
  const activeTable = tables.find((t) => t.id === activeTableId) ?? tables[0]
  const activeView =
    activeTable?.views.find((v) => v.id === activeViewIds[activeTable.id]) ?? activeTable?.views[0]
  const update = useUpdateTable(id, activeTable?.id ?? '')

  const selectView = (viewId: string): void =>
    setActiveViewIds((prev) => (activeTable ? { ...prev, [activeTable.id]: viewId } : prev))

  if (isLoading) return <div className="h-full" />
  if (!project || isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    )
  }

  const records = activeTable?.records ?? []
  // Only the table view currently supports filters, so that's the only view
  // whose record count can differ from the table total.
  const displayedRecords =
    activeView?.type === 'table' && activeTable
      ? applyFilters(records, activeView.config.filters, activeTable.fields)
      : records
  const filtered = displayedRecords.length !== records.length

  return (
    // Relation cells resolve the records they link to through this — it's the
    // one thing in a view that has to see past its own table.
    <ProjectTablesContext.Provider value={tables}>
      <div className="flex h-full flex-col">
        <PageHeader>
          <span className="shrink-0 px-1 text-sm font-semibold tracking-tight">{project.name}</span>
          <Separator orientation="vertical" className="mx-1 !h-4" />
          <TableTabs
            project={project}
            activeTableId={activeTable?.id}
            onSelect={setActiveTableId}
            update={updateProject}
          />
          <span className="ml-auto shrink-0 pl-2 pr-1 text-xs text-muted-foreground">
            {displayedRecords.length} record{displayedRecords.length === 1 ? '' : 's'}
            {filtered ? ` of ${records.length}` : ''}
          </span>
        </PageHeader>

        {activeTable && (
          <ViewTabs
            table={activeTable}
            activeViewId={activeView?.id}
            onSelect={selectView}
            update={update}
          />
        )}

        <div className="min-h-0 flex-1">
          {activeTable && activeView?.type === 'table' && (
            <TableView
              projectId={project.id}
              table={activeTable}
              view={activeView}
              update={update}
              onOpenRecord={setOpenRecordId}
            />
          )}
          {activeTable && activeView?.type === 'kanban' && (
            <KanbanView
              table={activeTable}
              view={activeView}
              update={update}
              onOpenRecord={setOpenRecordId}
            />
          )}
          {activeTable && activeView?.type === 'gallery' && (
            <GalleryView
              table={activeTable}
              view={activeView}
              update={update}
              onOpenRecord={setOpenRecordId}
            />
          )}
          {activeTable && activeView?.type === 'calendar' && (
            <CalendarView
              table={activeTable}
              view={activeView}
              update={update}
              onOpenRecord={setOpenRecordId}
            />
          )}
        </div>

        {activeTable && (
          <RecordSheet
            projectId={project.id}
            table={activeTable}
            recordId={openRecordId}
            onClose={() => setOpenRecordId(null)}
            update={update}
          />
        )}
      </div>
    </ProjectTablesContext.Provider>
  )
}

function TableTabs({
  project,
  activeTableId,
  onSelect,
  update
}: {
  project: Project
  activeTableId?: string
  onSelect: (tableId: string) => void
  update: ProjectUpdater
}): React.JSX.Element {
  const [renameTable, setRenameTable] = useState<Table | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const confirmDeleteTable = async (table: Table): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog({
      title: `Delete "${table.name}"?`,
      message: `Delete "${table.name}"?`,
      detail: `This permanently deletes the table, its fields and views, and all ${table.records.length} of its records.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (!confirmed) return
    const remaining = project.tables.filter((t) => t.id !== table.id)
    if (remaining[0]) onSelect(remaining[0].id)
    update((p) => ops.deleteTable(p, table.id))
  }

  const commitRename = (): void => {
    const name = renameValue.trim()
    if (renameTable && name) update((p) => ops.renameTable(p, renameTable.id, name))
    setRenameTable(null)
  }

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {project.tables.map((table) => {
        const active = table.id === activeTableId
        return (
          <div
            key={table.id}
            className={cn(
              'flex h-7 shrink-0 items-center rounded-md text-[13px] transition-colors',
              active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            <button
              className={cn('flex h-full items-center pl-2', active ? 'pr-0.5' : 'pr-2')}
              onClick={() => onSelect(table.id)}
            >
              {table.name}
            </button>
            {active && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="flex h-full items-center rounded-r-md px-1 hover:bg-accent">
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameValue(table.name)
                      setRenameTable(table)
                    }}
                  >
                    Rename table
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      update((p) => {
                        const next = ops.duplicateTable(p, table.id)
                        const copy = next.tables[next.tables.findIndex((t) => t.id === table.id) + 1]
                        if (copy) onSelect(copy.id)
                        return next
                      })
                    }
                  >
                    Duplicate table
                  </DropdownMenuItem>
                  {/* A project always keeps at least one table. */}
                  {project.tables.length > 1 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => void confirmDeleteTable(table)}
                      >
                        Delete table
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        title="Add table"
        onClick={() =>
          update((p) => {
            const next = ops.addTable(p)
            onSelect(next.tables[next.tables.length - 1].id)
            return next
          })
        }
      >
        <Plus />
        <span className="sr-only">Add table</span>
      </Button>

      <Dialog open={renameTable !== null} onOpenChange={(open) => !open && setRenameTable(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename table</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commitRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTable(null)}>
              Cancel
            </Button>
            <Button disabled={!renameValue.trim()} onClick={commitRename}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ViewTabs({
  table,
  activeViewId,
  onSelect,
  update
}: {
  table: Table
  activeViewId?: string
  onSelect: (viewId: string) => void
  update: TableUpdater
}): React.JSX.Element {
  const [renameView, setRenameView] = useState<View | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // The first view is the table's default/primary view and can't be
  // deleted, mirroring how Airtable/Notion-style tools protect it.
  const defaultViewId = table.views[0]?.id

  const confirmDeleteView = async (view: View): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog({
      title: `Delete "${view.name}"?`,
      message: `Delete "${view.name}"?`,
      detail: 'This removes the view and its filters, sorts, and layout. Records aren’t affected.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (confirmed) update((t) => ops.deleteView(t, view.id))
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-3">
      {table.views.map((view) => {
        const Icon = VIEW_ICONS[view.type]
        const active = view.id === activeViewId
        return (
          <div
            key={view.id}
            className={cn(
              'flex h-7 items-center rounded-md text-[13px] transition-colors',
              active ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            <button
              className={cn('flex h-full items-center gap-1.5 pl-2', active ? 'pr-0.5' : 'pr-2')}
              onClick={() => onSelect(view.id)}
            >
              <Icon className="size-3.5" />
              {view.name}
            </button>
            {active && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button className="flex h-full items-center rounded-r-md px-1 hover:bg-accent">
                      <ChevronDown className="size-3 text-muted-foreground" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameValue(view.name)
                      setRenameView(view)
                    }}
                  >
                    Rename view
                  </DropdownMenuItem>
                  {view.id !== defaultViewId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => void confirmDeleteView(view)}>
                        Delete view
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground">
              <Plus />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {(['table', 'kanban', 'gallery', 'calendar'] as const).map((type) => {
            const Icon = VIEW_ICONS[type]
            return (
              <DropdownMenuItem
                key={type}
                onClick={() =>
                  update((t) => {
                    const next = ops.addView(t, type)
                    onSelect(next.views[next.views.length - 1].id)
                    return next
                  })
                }
              >
                <Icon />
                {type === 'table'
                  ? 'Table'
                  : type === 'kanban'
                    ? 'Kanban'
                    : type === 'gallery'
                      ? 'Gallery'
                      : 'Calendar'}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameView !== null} onOpenChange={(open) => !open && setRenameView(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameView && renameValue.trim()) {
                update((t) => ops.renameView(t, renameView.id, renameValue.trim()))
                setRenameView(null)
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameView(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                if (renameView && renameValue.trim()) {
                  update((t) => ops.renameView(t, renameView.id, renameValue.trim()))
                  setRenameView(null)
                }
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
