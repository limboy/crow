import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CalendarDays,
  ChartColumn,
  ChevronDown,
  GalleryVertical,
  Plus,
  Redo2,
  SquareKanban,
  Table2,
  Undo2,
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
import { ProjectCommandPalette } from '@/components/ProjectSearchDialogs'
import { RecordSheet } from '@/components/RecordSheet'
import { TableView } from '@/views/TableView'
import { KanbanView } from '@/views/KanbanView'
import { GalleryView } from '@/views/GalleryView'
import { CalendarView } from '@/views/CalendarView'
import { DashboardView } from '@/views/DashboardView'
import * as ops from '@/lib/ops'
import { detectDelimiter, parseDelimited, serializeDelimited } from '@/lib/csv'
import { csvRows, tableFromCsv } from '@/lib/csvTable'
import { applyFilters, applySorts } from '@/lib/derive'
import { ProjectTablesContext, useProjectTables } from '@/lib/relations'
import {
  useProject,
  useProjectHistory,
  useProjects,
  useUpdateProject,
  useUpdateTable,
  type ProjectHistory,
  type ProjectUpdater,
  type TableUpdater
} from '@/lib/queries'
import { isMac } from '@/lib/format'
import { cn, isTextEntry } from '@/lib/utils'

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: SquareKanban,
  gallery: GalleryVertical,
  calendar: CalendarDays,
  dashboard: ChartColumn
}

/** View types a table can add, in the order the menu offers them. */
const VIEW_TYPE_LABELS: { type: ViewType; label: string }[] = [
  { type: 'table', label: 'Table' },
  { type: 'kanban', label: 'Kanban' },
  { type: 'gallery', label: 'Gallery' },
  { type: 'calendar', label: 'Calendar' },
  { type: 'dashboard', label: 'Dashboard' }
]

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
  const history = useProjectHistory(id)
  useUndoRedoShortcuts(history)

  const [activeTableId, setActiveTableId] = useState<string>()
  // Remembered per table, so switching tables and coming back lands on the
  // view you left rather than resetting to the first one.
  const [activeViewIds, setActiveViewIds] = useState<Record<string, string>>({})
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)
  const { commandOpen, setCommandOpen } = useCommandShortcut()

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
  const selectTableView = (tableId: string, viewId: string): void => {
    setActiveTableId(tableId)
    setActiveViewIds((prev) => ({ ...prev, [tableId]: viewId }))
  }

  if (isLoading) return <div className="h-full" />
  if (!project || isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    )
  }

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
          <Separator orientation="vertical" className="ml-auto mr-1 !h-4" />
          <HistoryButtons history={history} />
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
          {/* A dashboard shows aggregates rather than rows, so nothing on it
              opens a record. */}
          {activeTable && activeView?.type === 'dashboard' && (
            <DashboardView table={activeTable} view={activeView} update={update} />
          )}
        </div>

        {activeTable && (
          <RecordSheet
            projectId={project.id}
            table={activeTable}
            view={activeView}
            recordId={openRecordId}
            onClose={() => setOpenRecordId(null)}
            update={update}
          />
        )}

        <ProjectCommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          projects={projects ?? []}
          project={project}
          activeTableId={activeTable?.id}
          activeViewId={activeView?.id}
          onSelectProject={(projectId) => navigate(`/project/${projectId}`)}
          onSelectTable={setActiveTableId}
          onSelectView={selectTableView}
        />
      </div>
    </ProjectTablesContext.Provider>
  )
}

/** Cmd/Ctrl+K opens navigation; each searchable view owns Cmd/Ctrl+F. */
function useCommandShortcut(): {
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
} {
  const [commandOpen, setCommandOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 'k'
      ) {
        return
      }
      event.preventDefault()
      setCommandOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { commandOpen, setCommandOpen }
}

/** ⌘Z / ⇧⌘Z, plus Ctrl+Y where that's the convention. Bound on the document
 *  rather than a container so it works no matter which view is up. */
function useUndoRedoShortcuts({ undo, redo }: ProjectHistory): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Mid-composition (Pinyin, Kana, …) the keystroke belongs to the IME.
      if (e.isComposing || !(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = key === 'z' ? e.shiftKey : key === 'y' && !isMac
      if (!isUndo && !isRedo) return
      if (isTextEntry(e.target)) return
      e.preventDefault()
      if (isRedo) redo()
      else undo()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])
}

function HistoryButtons({ history }: { history: ProjectHistory }): React.JSX.Element {
  const undoKeys = isMac ? '⌘Z' : 'Ctrl+Z'
  const redoKeys = isMac ? '⇧⌘Z' : 'Ctrl+Y'
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        title={`Undo (${undoKeys})`}
        disabled={!history.canUndo}
        onClick={history.undo}
      >
        <Undo2 />
        <span className="sr-only">Undo</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        title={`Redo (${redoKeys})`}
        disabled={!history.canRedo}
        onClick={history.redo}
      >
        <Redo2 />
        <span className="sr-only">Redo</span>
      </Button>
    </div>
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

  /** Keeps two imports of the same file from producing two identical tabs. */
  const availableTableName = (base: string): string => {
    const taken = new Set(project.tables.map((t) => t.name))
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`
    return name
  }

  const importCsv = async (): Promise<void> => {
    const file = await window.api.importCsv()
    // Null covers both a cancelled picker and a file the main process already
    // reported on, so there's nothing left to say here.
    if (!file) return
    const grid = parseDelimited(file.text, detectDelimiter(file.text))
    const imported = tableFromCsv(availableTableName(file.name.trim() || 'Imported'), grid)
    if (!imported) return
    update((p) => ops.insertTable(p, imported))
    onSelect(imported.id)
  }

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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void importCsv()}>
                    Import CSV…
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
  // Relation columns export as the labels of the records they link to, which
  // live in a sibling table.
  const tables = useProjectTables()

  // The first view is the table's default/primary view and can't be
  // deleted, mirroring how Airtable/Notion-style tools protect it.
  const defaultViewId = table.views[0]?.id

  /**
   * Exports what the view shows, not the raw table: its filters and sorts
   * applied, its hidden fields left out. Every view type keeps those three
   * settings, so a Kanban or Gallery exports as sensibly as a grid does.
   */
  const exportCsv = async (view: View): Promise<void> => {
    const fields = table.fields.filter((f) => !view.config.hiddenFieldIds.includes(f.id))
    const records = applySorts(
      applyFilters(table.records, view.config.filters, table.fields, view.config.filterMatch),
      view.config.sorts,
      table.fields,
      tables
    )
    const name = view.id === defaultViewId ? table.name : `${table.name} - ${view.name}`
    await window.api.exportCsv(name, serializeDelimited(csvRows(fields, records, tables), ','))
  }

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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void exportCsv(view)}>
                    Export CSV…
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
          {VIEW_TYPE_LABELS.map(({ type, label }) => {
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
                {label}
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
