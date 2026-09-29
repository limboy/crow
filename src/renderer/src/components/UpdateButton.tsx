import { useEffect, useState } from 'react'

type PreviewListener = (version: string | null) => void
const previewListeners = new Set<PreviewListener>()

// Registered once at module load — independent of any component's mount
// lifecycle, so it's there whichever page happens to render the button. If
// nothing's currently subscribed this is just a no-op.
if (import.meta.env.DEV) {
  window.__triggerUpdatePreview = (version) => {
    for (const listener of previewListeners) listener(version)
  }
}

export function UpdateButton(): React.JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.api.getUpdateStatus().then(setVersion)
    const unsubscribe = window.api.onUpdateReady(setVersion)

    previewListeners.add(setVersion)
    return () => {
      unsubscribe()
      previewListeners.delete(setVersion)
    }
  }, [])

  if (!version) return null

  const handleInstall = (): void => {
    setInstalling(true)
    void window.api.installUpdate()
  }

  return (
    <button
      onClick={handleInstall}
      disabled={installing}
      title={`Update to v${version} is ready — click to install and restart`}
      className="no-drag inline-flex items-center gap-1.5 rounded-full bg-blue-400 px-3 py-[5px] text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:pointer-events-none disabled:opacity-60"
    >
      {installing ? 'Installing…' : 'Update'}
    </button>
  )
}
