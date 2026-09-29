import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UpdateButton } from '@/components/UpdateButton'
import { isMac } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Shared top bar for the routed pages. It doubles as the window's title bar,
 * so on macOS it leaves room for the traffic lights, and it ends with the
 * app-wide controls: the update button (when one is ready) and the theme toggle.
 */
export function PageHeader({
  children,
  className
}: {
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <header
      className={cn(
        'titlebar-drag flex h-12 shrink-0 items-center gap-1 border-b px-2',
        isMac && 'pl-20',
        className
      )}
    >
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <UpdateButton />
        <ThemeToggle />
      </div>
    </header>
  )
}
