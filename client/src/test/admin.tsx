import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { ToastProvider } from '../components/ui/Toast'

/**
 * Render admin routes in a data router (so `useBlocker` works) with queries, toasts and Helmet. The router
 * starts at the last of `history`; the entries before it are what browser Back returns to, through
 * the returned `router`'s `navigate(-1)`.
 */
export function renderAdminRoutes(routes: { path: string; element: ReactElement }[], { history }: { history: string[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(
    routes.map(({ path, element }) => ({ path, element: <ToastProvider>{element}</ToastProvider> })),
    { initialEntries: history, initialIndex: history.length - 1 },
  )
  const result = render(
    <HelmetProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HelmetProvider>,
  )
  return { ...result, router }
}

/** The current path, for asserting where a navigation went. */
export function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}</output>
}

/** Fire `beforeunload` as a reload or tab close would; true when the page asked to stay. */
export function reloadIsHeld(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
