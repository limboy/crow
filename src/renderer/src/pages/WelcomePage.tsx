import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Plus } from 'lucide-react'
import type { RecentDocument } from '@shared/types'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { isMac } from '@/lib/format'

/** Shown when no document is open: make one, open one, or reopen a recent one. */
export default function WelcomePage(): React.JSX.Element {
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [legacyCount, setLegacyCount] = useState(0)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const loadRecent = (): void => void window.api.getRecentDocuments().then(setRecent)
    loadRecent()
    void window.api.getLegacyProjectCount().then(setLegacyCount)
    return window.api.onRecentDocumentsChanged(loadRecent)
  }, [])

  const openRecentContextMenu = (path: string) => async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const action = await window.api.showContextMenu([
      { id: 'open', label: 'Open' },
      { id: 'reveal', label: isMac ? 'Show in Finder' : 'Show in Folder' }
    ])
    if (action === 'open') void window.api.openDocument(path)
    else if (action === 'reveal') void window.api.revealDocument(path)
  }

  const handleExportLegacy = async (): Promise<void> => {
    setExporting(true)
    try {
      if (await window.api.exportLegacyProjects()) setLegacyCount(0)
    } finally {
      setExporting(false)
    }
  }

  const mod = isMac ? '⌘' : 'Ctrl+'

  return (
    <div className="flex h-full flex-col">
      <PageHeader />

      <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 py-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => void window.api.newDocument()}>
              <Plus data-icon="inline-start" />
              New…
              <kbd className="ml-auto text-xs opacity-60">{mod}N</kbd>
            </Button>
            <Button
              className="flex-1"
              variant="outline"
              onClick={() => void window.api.openDocument()}
            >
              <FolderOpen data-icon="inline-start" />
              Open…
              <kbd className="ml-auto text-xs opacity-60">{mod}O</kbd>
            </Button>
          </div>

          {legacyCount > 0 && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p>
                An earlier version of Crow kept {legacyCount} project{legacyCount === 1 ? '' : 's'} in
                its own data folder. Crow now opens and saves <code>.crow</code> files — export them
                to keep working on them.
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void handleExportLegacy()}
                >
                  {exporting ? 'Exporting…' : 'Export as .crow Files…'}
                </Button>
              </div>
            </div>
          )}

          {recent.length > 0 && (
            <section className="flex flex-col gap-1">
              <h2 className="px-2 text-xs font-medium text-muted-foreground">Recent</h2>
              <ul className="flex flex-col">
                {recent.map((doc) => (
                  <li key={doc.path}>
                    <button
                      type="button"
                      title={doc.path}
                      onClick={() => void window.api.openDocument(doc.path)}
                      onContextMenu={openRecentContextMenu(doc.path)}
                      className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="max-w-[70%] shrink-0 truncate">{doc.name}</span>
                      <span className="min-w-0 flex-1 truncate pl-4 text-right text-xs text-muted-foreground">
                        {doc.displayPath}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
