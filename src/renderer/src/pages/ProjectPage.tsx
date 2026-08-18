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
import type { Project, View, ViewType } from '@shared/types'
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
import { PageHeader } from '@/components/PageHeader'
import { RecordSheet } from '@/components/RecordSheet'
import { TableView } from '@/views/TableView'
import { KanbanView } from '@/views/KanbanView'
import { GalleryView } from '@/views/GalleryView'
import { CalendarView } from '@/views/CalendarView'
import * as ops from '@/lib/ops'
import { applyFilters } from '@/lib/derive'
import { useProject, useProjects, useUpdateProject, type ProjectUpdater } from '@/lib/queries'
import { cn } from '@/lib/utils'

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: SquareKanban,
  gallery: GalleryVertical,
  calendar: CalendarDays
}

export interface ViewProps {
  project: Project
  view: View
  update: ProjectUpdater
  onOpenRecord: (recordId: string) => void
}

export default function ProjectPage(): React.JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: project, isLoading, isError } = useProject(id)
  const { data: projects, isLoading: isLoadingProjects } = useProjects()
  const update = useUpdateProject(id)

  const [activeViewId, setActiveViewId] = useState<string>()
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

  if (isLoading) return <div className="h-full" />
  if (!project || isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project not found.</p>
      </div>
    )
  }

  const activeView = project.views.find((v) => v.id === activeViewId) ?? project.views[0]

  // Only the table view currently supports filters, so that's the only view
  // whose record count can differ from the project total.
  const displayedRecords =
    activeView?.type === 'table'
      ? applyFilters(project.records, activeView.config.filters, project.fields)
      : project.records
  const filtered = displayedRecords.length !== project.records.length

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <span className="text-sm font-semibold tracking-tight">{project.name}</span>
        <span className="ml-auto mr-2 text-xs text-muted-foreground">
          {displayedRecords.length} record{displayedRecords.length === 1 ? '' : 's'}
          {filtered ? ` of ${project.records.length}` : ''}
        </span>
      </PageHeader>

      <ViewTabs
        project={project}
        activeViewId={activeView?.id}
        onSelect={setActiveViewId}
        update={update}
      />

      <div className="min-h-0 flex-1">
        {activeView?.type === 'table' && (
          <TableView project={project} view={activeView} update={update} onOpenRecord={setOpenRecordId} />
        )}
        {activeView?.type === 'kanban' && (
          <KanbanView project={project} view={activeView} update={update} onOpenRecord={setOpenRecordId} />
        )}
        {activeView?.type === 'gallery' && (
          <GalleryView project={project} view={activeView} update={update} onOpenRecord={setOpenRecordId} />
        )}
        {activeView?.type === 'calendar' && (
          <CalendarView project={project} view={activeView} update={update} onOpenRecord={setOpenRecordId} />
        )}
      </div>

      <RecordSheet
        project={project}
        recordId={openRecordId}
        onClose={() => setOpenRecordId(null)}
        update={update}
      />
    </div>
  )
}

function ViewTabs({
  project,
  activeViewId,
  onSelect,
  update
}: {
  project: Project
  activeViewId?: string
  onSelect: (viewId: string) => void
  update: ProjectUpdater
}): React.JSX.Element {
  const [renameView, setRenameView] = useState<View | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // The first view is the project's default/primary view and can't be
  // deleted, mirroring how Airtable/Notion-style tools protect it.
  const defaultViewId = project.views[0]?.id

  const confirmDeleteView = async (view: View): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog({
      title: `Delete "${view.name}"?`,
      message: `Delete "${view.name}"?`,
      detail: 'This removes the view and its filters, sorts, and layout. Records aren’t affected.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (confirmed) update((p) => ops.deleteView(p, view.id))
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-3">
      {project.views.map((view) => {
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
                  update((p) => {
                    const next = ops.addView(p, type)
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
                update((p) => ops.renameView(p, renameView.id, renameValue.trim()))
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
                  update((p) => ops.renameView(p, renameView.id, renameValue.trim()))
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
