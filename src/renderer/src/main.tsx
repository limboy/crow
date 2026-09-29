import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './assets/main.css'
// Side effect: applies the system theme to <html>
// before the app renders, so the correct theme is present on first paint.
import './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data only changes through this window, so never refetch over
      // optimistically-updated caches.
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
})

// Chromium's default for an unhandled drop is to navigate the window to the
// dropped file, replacing the whole app. Field-level drop zones call
// preventDefault() themselves; this is just the fallback for drops that miss.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
