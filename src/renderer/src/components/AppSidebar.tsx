import { useState } from 'react'
import { NavLink, useMatch, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Settings } from 'lucide-react'
import type { ProjectMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar'
import { useCreateProject, useDeleteProject, useImportProject, useProjects } from '@/lib/queries'
import { isMac } from '@/lib/format'
import { cn } from '@/lib/utils'
import { UpdateButton } from '@/components/UpdateButton'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ThemeToggle } from '@/components/ThemeToggle'

export function AppSidebar(): React.JSX.Element {
  const navigate = useNavigate()
  const activeId = useMatch('/project/:id')?.params.id
  const { data: projects, isLoading } = useProjects()
  const createProject = useCreateProject()
  const importProject = useImportProject()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleCreate = (): void => {
    createProject.mutate(newName, {
      onSuccess: (project) => {
        setCreateOpen(false)
        setNewName('')
        navigate(`/project/${project.id}`)
      }
    })
  }

  const handleImport = (): void => {
    importProject.mutate(undefined, {
      onSuccess: (project) => {
        if (project) navigate(`/project/${project.id}`)
      }
    })
  }

  // The + button offers both ways to get a project, keeping import as
  // discoverable as create without spending another slot in the header row.
  const handleAdd = async (): Promise<void> => {
    const action = await window.api.showContextMenu([
      { id: 'create', label: 'New project' },
      { id: 'import', label: 'Import project…' }
    ])
    if (action === 'create') setCreateOpen(true)
    else if (action === 'import') handleImport()
  }

  return (
    <Sidebar>
      {/* Empty drag spacer: still reserves room for the macOS traffic lights
          and keeps the top of the sidebar draggable now that the title row
          is gone. */}
      <div className={cn('titlebar-drag shrink-0', isMac ? 'h-10' : 'h-2')} />

      <UpdateButton />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="cursor-default">Projects</SidebarGroupLabel>
          <SidebarGroupAction title="Add project" onClick={handleAdd}>
            <Plus />
            <span className="sr-only">Add project</span>
          </SidebarGroupAction>
          <SidebarMenu>
            {isLoading ? null : projects && projects.length > 0 ? (
              projects.map((project) => (
                <ProjectMenuItem key={project.id} project={project} activeId={activeId} />
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet.</p>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton
              className="w-auto flex-1 cursor-default"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Project name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createProject.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}

function ProjectMenuItem({
  project,
  activeId
}: {
  project: ProjectMeta
  activeId: string | undefined
}): React.JSX.Element {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deleteProject = useDeleteProject()

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(project.name)

  const handleRename = (): void => {
    const name = renameValue.trim()
    setRenameOpen(false)
    if (!name || name === project.name) return
    void window.api.getProject(project.id).then(async (full) => {
      const updated = { ...full, name, updatedAt: new Date().toISOString() }
      await window.api.saveProject(updated)
      queryClient.setQueryData(['project', project.id], updated)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    })
  }

  const handleDelete = (): void => {
    deleteProject.mutate(project.id)
    if (project.id === activeId) {
      const remaining = (queryClient.getQueryData<ProjectMeta[]>(['projects']) ?? []).filter(
        (p) => p.id !== project.id
      )
      navigate(remaining.length > 0 ? `/project/${remaining[0].id}` : '/')
    }
  }

  const confirmDelete = async (): Promise<void> => {
    const confirmed = await window.api.showConfirmDialog({
      title: `Delete "${project.name}"?`,
      message: `Delete "${project.name}"?`,
      detail: `This permanently deletes the project, its ${project.tableCount} table${
        project.tableCount === 1 ? '' : 's'
      }, and all ${project.recordCount} of their records.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true
    })
    if (confirmed) handleDelete()
  }

  const handleContextMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const action = await window.api.showContextMenu([
      { id: 'rename', label: 'Rename' },
      { id: 'export', label: 'Export…' },
      { id: 'sep', label: '', type: 'separator' },
      { id: 'delete', label: 'Delete', danger: true }
    ])
    if (action === 'rename') {
      setRenameValue(project.name)
      setRenameOpen(true)
    } else if (action === 'export') {
      void window.api.exportProject(project.id)
    } else if (action === 'delete') {
      void confirmDelete()
    }
  }

  return (
    <>
      <SidebarMenuItem onContextMenu={handleContextMenu}>
        <SidebarMenuButton
          className="cursor-default"
          isActive={project.id === activeId}
          render={
            <NavLink to={`/project/${project.id}`}>
              <span className="truncate">{project.name}</span>
            </NavLink>
          }
        />
      </SidebarMenuItem>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
