/// <reference types="vite/client" />
import type { Api } from '@shared/types'

declare global {
  interface Window {
    api: Api
    /** Dev-only: force the header's update-ready state to preview its styling. `null` clears it. */
    __triggerUpdatePreview?: (version: string | null) => void
  }
}

export {}
