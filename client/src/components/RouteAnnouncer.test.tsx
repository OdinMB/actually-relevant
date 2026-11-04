import { lazy, Suspense, type ComponentType } from 'react'
import { describe, it, expect } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Link, Navigate, Outlet, RouterProvider } from 'react-router-dom'
import { Helmet, HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import RouteAnnouncer from './RouteAnnouncer'
import { routeFallbackProps } from '../lib/renderComplete'

/** Longer than the announcer needs on an idle page, to show that nothing comes. */
const QUIET_MS = 400

function Page({ title }: { title: string }) {
  return (
    <>
      <Helmet>
        <title>{title}</title>
      </Helmet>
      <h1>{title}</h1>
    </>
  )
}

let deliverStoryTitle: (title: string) => void = () => {}
/** A page whose title comes with its data, as on a story page. */
function StoryPage() {
  const { data } = useQuery({ queryKey: ['story'], queryFn: () => new Promise<string>(resolve => (deliverStoryTitle = resolve)) })
  return data ? <Page title={data} /> : <p>Loading the story</p>
}

let deliverChunk: (module: { default: ComponentType }) => void = () => {}
const LazyPage = lazy(() => new Promise<{ default: ComponentType }>(resolve => (deliverChunk = resolve)))

function Layout() {
  return (
    <>
      <RouteAnnouncer />
      <nav>
        <Link to="/b">Go to B</Link>
        <Link to="/a?mix=uplifting">Change the mix</Link>
        <Link to="/a#section">Jump to the section</Link>
      </nav>
      <main>
        <Outlet />
        <button type="button">A control in the page</button>
      </main>
    </>
  )
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        // As DefaultSeo does: the title a page shows until it sets its own
        element: (
          <>
            <Helmet>
              <title>Site default</title>
            </Helmet>
            <Outlet />
          </>
        ),
        children: [
          {
            element: <Layout />,
            children: [
              { path: '/a', element: <Page title="Page A" /> },
              { path: '/b', element: <Page title="Page B" /> },
              { path: '/story', element: <StoryPage /> },
              {
                path: '/lazy',
                element: (
                  <Suspense fallback={<div {...routeFallbackProps}>Loading the page</div>}>
                    <LazyPage />
                  </Suspense>
                ),
              },
              { path: '/old', element: <Navigate to="/a" replace /> },
              { path: '/admin/stories', element: <Page title="Admin stories" /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </HelmetProvider>,
  )
  return router
}

const announcement = () => screen.getByRole('status')
const quietPeriod = () => act(() => new Promise(resolve => setTimeout(resolve, QUIET_MS)))

describe('RouteAnnouncer', () => {
  it('announces nothing and leaves focus alone on the first page load', async () => {
    renderAt('/a')
    await screen.findByRole('heading', { name: 'Page A' })
    await quietPeriod()

    expect(announcement()).toBeEmptyDOMElement()
    expect(document.activeElement).toBe(document.body)
  })

  it('after a link to another page, focuses the main region and announces the new page title', async () => {
    renderAt('/a')
    const link = screen.getByRole('link', { name: 'Go to B' })
    link.focus()
    fireEvent.click(link)

    await waitFor(() => expect(announcement()).toHaveTextContent('Page B'))
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  // A lasting tabindex would let a click on the page's text take focus, and Tab would start over at the top
  it('keeps the main region focusable only until focus moves on', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByRole('link', { name: 'Go to B' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')))
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')

    screen.getByRole('button', { name: 'A control in the page' }).focus()
    expect(screen.getByRole('main')).not.toHaveAttribute('tabindex')
  })

  it('announces the page Back returns to', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/b'))
    await waitFor(() => expect(announcement()).toHaveTextContent('Page B'))

    await act(() => router.navigate(-1))
    await waitFor(() => expect(announcement()).toHaveTextContent('Page A'))
  })

  it.each([
    ['the query string', 'Change the mix', '?mix=uplifting', ''],
    ['the hash', 'Jump to the section', '', '#section'],
  ])('keeps focus and announces nothing when only %s changes', async (_part, name, search, hash) => {
    const router = renderAt('/a')
    const link = screen.getByRole('link', { name })
    link.focus()
    fireEvent.click(link)
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/a', search, hash }))
    await quietPeriod()

    expect(announcement()).toBeEmptyDOMElement()
    expect(document.activeElement).toBe(link)
  })

  it('waits for the page data, so it announces the title the page sets with it, not the default', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/story'))
    await screen.findByText('Loading the story')
    await quietPeriod()
    expect(document.title).toBe('Site default')
    expect(announcement()).toBeEmptyDOMElement()

    act(() => deliverStoryTitle('A fresh story'))
    await waitFor(() => expect(announcement()).toHaveTextContent('A fresh story'))
  })

  it('waits while the page chunk loads', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/lazy'))
    await quietPeriod()
    expect(announcement()).toBeEmptyDOMElement()

    await act(async () => deliverChunk({ default: () => <Page title="Lazy page" /> }))
    await waitFor(() => expect(announcement()).toHaveTextContent('Lazy page'))
  })

  it('treats a redirect while the first page loads as part of that load', async () => {
    const router = renderAt('/old')
    await waitFor(() => expect(router.state.location.pathname).toBe('/a'))
    await quietPeriod()

    expect(announcement()).toBeEmptyDOMElement()
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the admin pages alone', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/admin/stories'))
    await screen.findByRole('heading', { name: 'Admin stories' })
    await quietPeriod()

    expect(announcement()).toBeEmptyDOMElement()
    expect(document.activeElement).not.toBe(screen.getByRole('main'))
  })
})
