import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { clearHistory } from '@/lib/history'
import { useProjects } from '@/lib/queries'
import ProjectListPage from './pages/ProjectListPage'
import ProjectPage from './pages/ProjectPage'

/** Landing route: jump straight into the most recently updated project, if any. */
function Home(): React.JSX.Element {
  const { data: projects, isLoading } = useProjects()
  if (isLoading) return <div className="h-full" />
  if (projects && projects.length > 0) {
    return <Navigate to={`/project/${projects[0].id}`} replace />
  }
  return <ProjectListPage />
}

export default function App(): React.JSX.Element {
  const queryClient = useQueryClient()

  // Refetch everything when project files change on disk (e.g. via the CLI).
  // Undo history describes documents this app built, so it can't survive a
  // version that came from outside — undoing back past it would throw the
  // external edit away.
  useEffect(
    () =>
      window.api.onProjectsChanged(() => {
        clearHistory()
        void queryClient.invalidateQueries()
      }),
    [queryClient]
  )

  return (
    <SidebarProvider className="h-full min-h-0">
      <AppSidebar />
      <SidebarInset className="min-h-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/project/:id" element={<ProjectPage />} />
        </Routes>
      </SidebarInset>
    </SidebarProvider>
  )
}
