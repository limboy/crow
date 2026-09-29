import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/use-theme'

export function ThemeToggle(): React.JSX.Element {
  const { resolved, toggle } = useTheme()
  const isDark = resolved === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'flex size-7 shrink-0 cursor-default items-center justify-center rounded-md',
        'text-muted-foreground outline-hidden ring-ring transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2',
        '[&>svg]:size-4 [&>svg]:shrink-0'
      )}
    >
      {isDark ? <Moon /> : <Sun />}
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
