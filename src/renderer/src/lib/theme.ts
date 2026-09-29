// The app always follows the OS appearance: the `dark` class on <html> tracks
// prefers-color-scheme, including changes while the app is open.
const media = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(): void {
  document.documentElement.classList.toggle('dark', media.matches)
}

// Applied as a side effect of importing this module (see main.tsx, imported
// before the app renders) so the right theme is already on <html> before
// the first paint instead of flashing light and then switching to dark.
applyTheme()
media.addEventListener('change', applyTheme)

// Drop the light/dark override the old theme toggle persisted.
localStorage.removeItem('crow-theme')
