import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { clearHistory } from '@/lib/history'
import { flushPendingSaves } from '@/lib/queries'
import WelcomePage from './pages/WelcomePage'
import ProjectPage from './pages/ProjectPage'

/** Each window is either the welcome screen or one open `.crow` document —
 *  the main process picks which by the route it loads. */
export default function App(): React.JSX.Element {
  const queryClient = useQueryClient()

  // Refetch everything when the document changes on disk (e.g. via the
  // CLI). Undo history describes documents this app built, so it can't
  // survive a version that came from outside — undoing back past it would
  // throw the external edit away.
  useEffect(
    () =>
      window.api.onProjectsChanged(() => {
        clearHistory()
        void queryClient.invalidateQueries()
      }),
    [queryClient]
  )

  // Before the window closes (or the app quits, or Save is pressed), every
  // edit this window is still holding back has to reach the document.
  useEffect(() => window.api.onFlushRequest(() => flushPendingSaves(queryClient)), [queryClient])

  return (
    <div className="h-full min-h-0 bg-background">
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/project/:id" element={<ProjectPage />} />
      </Routes>
    </div>
  )
}
