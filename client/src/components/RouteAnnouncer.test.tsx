import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Link, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router-dom'
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

/** A page with a section a link can name by its `#hash`. */
function SectionPage() {
  return (
    <>
      <Page title="Page C" />
      <h2 id="details">Details</h2>
    </>
  )
}

let deliverStoryTitle: (title: string) => void = () => {}
/** A page whose title and sections come with its data, as on a story page. */
function StoryPage() {
  const { data } = useQuery({ queryKey: ['story'], queryFn: () => new Promise<string>(resolve => (deliverStoryTitle = resolve)) })
  return data ? (
    <>
      <Page title={data} />
      <h2 id="story-details">Story details</h2>
    </>
  ) : (
    <p>Loading the story</p>
  )
}

let deliverMember: (title: string) => void = () => {}
/** A story slug that belongs to a cluster: once its data is there, the page replaces it with the cluster's primary story, as StoryPage does. */
function ClusterMemberPage() {
  const navigate = useNavigate()
  const { data } = useQuery({ queryKey: ['member'], queryFn: () => new Promise<string>(resolve => (deliverMember = resolve)) })
  useEffect(() => {
    if (data) navigate('/primary', { replace: true })
  }, [data, navigate])
  return data ? <Page title={data} /> : <p>Loading the member</p>
}

let deliverChunk: (module: { default: ComponentType }) => void = () => {}
const LazyPage = lazy(() => new Promise<{ default: ComponentType }>(resolve => (deliverChunk = resolve)))

function Layout() {
  return (
    <>
      <nav>
        <Link to="/b">Go to B</Link>
        <Link to="/a?mix=uplifting">Change the mix</Link>
        <Link to="/a#section">Jump to the section</Link>
        <Link to="/c#details">Go to the details of C</Link>
        <Link to="/b#nowhere">Go to a section B lacks</Link>
        <Link to="/member">Open a cluster member</Link>
        <Link to="/bare">Go to a page without main</Link>
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
        // As App.tsx's root route does: DefaultSeo's title, which a page shows until it sets its own, and the
        // announcer above every layout, so moving to a page outside this one counts too
        element: (
          <>
            <Helmet>
              <title>Site default</title>
            </Helmet>
            <RouteAnnouncer />
            <Outlet />
          </>
        ),
        children: [
          {
            element: <Layout />,
            children: [
              { path: '/a', element: <Page title="Page A" /> },
              { path: '/b', element: <Page title="Page B" /> },
              { path: '/c', element: <SectionPage /> },
              { path: '/story', element: <StoryPage /> },
              { path: '/member', element: <ClusterMemberPage /> },
              { path: '/primary', element: <Page title="Primary story" /> },
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
          // Outside the layout, as the developers page is: no <main> until its reference loads
          { path: '/bare', element: <Page title="Bare page" /> },
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

/** Every text the status region takes from now on, in order, as a screen reader would be handed them. */
function recordAnnouncements(): () => string[] {
  const said: string[] = []
  const observer = new MutationObserver(() => {
    const text = announcement().textContent ?? ''
    if (text) said.push(text)
  })
  observer.observe(announcement(), { childList: true, characterData: true, subtree: true })
  return () => said
}

describe('RouteAnnouncer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('leaves the admin pages alone, and takes the last public title out of the status region there', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/b'))
    await waitFor(() => expect(announcement()).toHaveTextContent('Page B'))
    screen.getByRole('button', { name: 'A control in the page' }).focus()

    await act(() => router.navigate('/admin/stories'))
    await screen.findByRole('heading', { name: 'Admin stories' })
    expect(announcement()).toBeEmptyDOMElement()
    await quietPeriod()

    expect(announcement()).toBeEmptyDOMElement()
    expect(document.activeElement).not.toBe(screen.getByRole('main'))
  })

  // A modal dialog makes the rest of the page inert, and then focus() does nothing
  it('leaves no tabindex on the main region when it cannot take focus', async () => {
    renderAt('/a')
    const main = screen.getByRole('main')
    vi.spyOn(main, 'focus').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('link', { name: 'Go to B' }))
    await waitFor(() => expect(announcement()).toHaveTextContent('Page B'))

    expect(main).not.toHaveAttribute('tabindex')
  })

  it('after a link to a section of another page, focuses that section instead of the main region', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByRole('link', { name: 'Go to the details of C' }))

    await waitFor(() => expect(announcement()).toHaveTextContent('Page C'))
    const details = screen.getByRole('heading', { name: 'Details' })
    expect(document.activeElement).toBe(details)
    expect(screen.getByRole('main')).not.toHaveAttribute('tabindex')

    screen.getByRole('button', { name: 'A control in the page' }).focus()
    expect(details).not.toHaveAttribute('tabindex')
  })

  it('focuses a section that comes with the page data once the page has loaded', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/story#story-details'))
    await screen.findByText('Loading the story')
    expect(document.activeElement).toBe(screen.getByRole('main'))

    act(() => deliverStoryTitle('A fresh story'))
    await waitFor(() => expect(announcement()).toHaveTextContent('A fresh story'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Story details' }))
  })

  it('leaves focus where the reader moved it while the page loaded, even when the section then appears', async () => {
    const router = renderAt('/a')
    await act(() => router.navigate('/story#story-details'))
    await screen.findByText('Loading the story')
    const control = screen.getByRole('button', { name: 'A control in the page' })
    control.focus()

    act(() => deliverStoryTitle('Another story'))
    await waitFor(() => expect(announcement()).toHaveTextContent('Another story'))
    expect(document.activeElement).toBe(control)
  })

  it('focuses the main region when the new page has no section of the link’s name', async () => {
    renderAt('/a')
    fireEvent.click(screen.getByRole('link', { name: 'Go to a section B lacks' }))

    await waitFor(() => expect(announcement()).toHaveTextContent('Page B'))
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('after a click that opens a cluster member, announces once, the primary story it is redirected to', async () => {
    const router = renderAt('/a')
    const said = recordAnnouncements()
    fireEvent.click(screen.getByRole('link', { name: 'Open a cluster member' }))
    await screen.findByText('Loading the member')

    act(() => deliverMember('Member story'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/primary'))
    await waitFor(() => expect(announcement()).toHaveTextContent('Primary story'))
    await quietPeriod()

    expect(said()).toEqual(['Primary story'])
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('announces a page without a main region, and moves no focus', async () => {
    renderAt('/a')
    const link = screen.getByRole('link', { name: 'Go to a page without main' })
    link.focus()
    fireEvent.click(link)

    await waitFor(() => expect(announcement()).toHaveTextContent('Bare page'))
    expect(screen.queryByRole('main')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})
