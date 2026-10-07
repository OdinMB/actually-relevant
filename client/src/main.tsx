import React, { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/query'
import { AuthProvider } from './lib/auth'
import { appRoutes } from './App'
import './index.css'

// A data router, so pages can block navigation (useBlocker) — browser Back included.
const router = createBrowserRouter(appRoutes)

// Accessibility: log a11y violations to console during development
if (import.meta.env.DEV) {
  import('@axe-core/react').then((axe) => {
    axe.default(React, ReactDOM, 1000)
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </HelmetProvider>
  </StrictMode>,
)

// Signal to prerenderer that rendering is complete
setTimeout(() => {
  document.dispatchEvent(new Event('render-complete'))
}, 100)
