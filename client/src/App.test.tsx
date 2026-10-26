import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { NonIndexRouteObject } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { appRoutes } from './App'

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HelmetProvider>,
  )
  return router
}

describe('appRoutes', () => {
  beforeAll(() => {
    // jsdom implements neither native <dialog> methods nor scrolling
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })

  it('renders an unknown path as the not-found page inside the public layout', async () => {
    const router = renderAt('/no-such-page')
    const main = await screen.findByRole('main')
    expect(within(main).getByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('banner')).toBeTruthy()
    const matches = router.state.matches
    expect(matches[matches.length - 1]!.route.path).toBe('*')
  })

  it('shows the branded error page, not the router default, when a route throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): never {
      throw new Error('render failed')
    }
    const root = appRoutes[0] as NonIndexRouteObject
    const router = createMemoryRouter([{ ...root, children: [...root.children!, { id: 'boom', path: '/boom', element: <Boom /> }] }], {
      initialEntries: ['/boom'],
    })
    render(
      <HelmetProvider>
        <RouterProvider router={router} />
      </HelmetProvider>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy()
    expect(screen.queryByText('render failed')).toBeNull()
    consoleError.mockRestore()
  })

  it('redirects the old newsletter archive URL to /newsletter, not to an issue page', async () => {
    const router = renderAt('/newsletter/archive')
    await waitFor(() => expect(router.state.location.pathname).toBe('/newsletter'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Newsletter' })).toBeTruthy()
  })
})
