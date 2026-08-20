import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Plus } from 'lucide-react'
import type { ProjectMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/PageHeader'
import { useCreateProject, useImportProject, useProjects } from '@/lib/queries'
import { timeAgo } from '@/lib/format'

export default function ProjectListPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { data: projects, isLoading } = useProjects()
  const createProject = useCreateProject()
  const importProject = useImportProject()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')

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

  return (
    <div className="flex h-full flex-col">
      <PageHeader />

      <main className="flex-1 overflow-y-auto">
        {isLoading ? null : projects && projects.length > 0 ? (
          <div className="mx-auto w-full max-w-5xl px-8 py-10">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus data-slot="icon" />
              New project
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleImport}
              disabled={importProject.isPending}
            >
              <Download data-slot="icon" />
              Import project
            </Button>
          </div>
        )}
      </main>

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
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectMeta }): React.JSX.Element {
  const navigate = useNavigate()

  return (
    <Card
      className="group gap-0 p-4 transition-colors hover:bg-accent/50"
      onClick={() => navigate(`/project/${project.id}`)}
    >
      <div className="flex size-9 items-center justify-center rounded-md border bg-muted/50 text-sm font-semibold uppercase text-muted-foreground">
        {project.name.charAt(0) || '?'}
      </div>
      <div className="mt-3">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {project.tableCount > 1 ? `${project.tableCount} tables · ` : ''}
          {project.recordCount} record{project.recordCount === 1 ? '' : 's'} · updated{' '}
          {timeAgo(project.updatedAt)}
        </div>
      </div>
    </Card>
  )
}
