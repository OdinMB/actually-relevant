import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, Link, NavigationType, Outlet, RouterProvider, useLocation, useSearchParams } from 'react-router-dom'
import { loadOffsets, restoreScroll, saveOffsets, scrollPlan, useAdminScroll } from './useAdminScroll'

/** A scroll box jsdom can't lay out: its offset and heights are plain values the test sets. */
function scrollBox(el: HTMLElement, { height = 5000, client = 500 } = {}) {
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight))
    },
  })
  setHeight(el, height)
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: client })
  return el
}

/** The page in the box grows (or shrinks) to `height`, as when its rows come in. */
function setHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height })
}

/** The person scrolls the box to `top`. */
function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll'))
}

describe('scrollPlan', () => {
  const offsets = new Map([
    ['list', 1200],
    ['story', 300],
  ])
  const nav = (over: Partial<Parameters<typeof scrollPlan>[0]>) => ({
    type: NavigationType.Push,
    key: 'new',
    pathname: '/admin/stories/s1',
    state: null,
    ...over,
  })
  const { Pop: POP, Replace: REPLACE } = NavigationType

  it('puts back the offset of the entry browser Back or Forward returns to', () => {
    expect(scrollPlan(nav({ type: POP, key: 'list', pathname: '/admin/stories' }), '/admin/stories/s1', offsets)).toEqual({ restore: 1200 })
  })

  it('puts back the offset of the entry a back link names', () => {
    expect(scrollPlan(nav({ pathname: '/admin/stories', state: { restoreScrollOf: 'list' } }), '/admin/stories/s1', offsets)).toEqual({ restore: 1200 })
  })

  it('starts another page at the top', () => {
    expect(scrollPlan(nav({}), '/admin/stories', offsets)).toBe('top')
    expect(scrollPlan(nav({ type: REPLACE }), '/admin/stories', offsets)).toBe('top')
    // An entry it has no offset for, or a back link naming one it never saw
    expect(scrollPlan(nav({ type: POP, key: 'unknown' }), '/admin/stories', offsets)).toBe('top')
    expect(scrollPlan(nav({ state: { restoreScrollOf: 'unknown' } }), '/admin/stories', offsets)).toBe('top')
  })

  it('keeps the offset when only the search changes (a filter, a page) and on the first load', () => {
    expect(scrollPlan(nav({ pathname: '/admin/stories' }), '/admin/stories', offsets)).toBe('keep')
    expect(scrollPlan(nav({ type: POP, key: 'unknown', pathname: '/admin/stories' }), null, offsets)).toBe('keep')
  })

  it('puts back a reloaded entry’s offset on the first load', () => {
    expect(scrollPlan(nav({ type: POP, key: 'story' }), null, offsets)).toEqual({ restore: 300 })
  })
})

describe('restoreScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for the page to grow tall enough, then holds the offset', () => {
    const el = scrollBox(document.createElement('div'), { height: 600 })
    restoreScroll(el, 1200)
    expect(el.scrollTop).toBe(100)
    setHeight(el, 3000) // the rows came in
    vi.advanceTimersByTime(50)
    expect(el.scrollTop).toBe(1200)
  })

  it('stops when the person scrolls first', () => {
    const el = scrollBox(document.createElement('div'), { height: 600 })
    restoreScroll(el, 1200)
    el.dispatchEvent(new Event('wheel'))
    setHeight(el, 3000)
    vi.advanceTimersByTime(50)
    expect(el.scrollTop).toBe(100)
  })

  it('gives up after two seconds, as far down as the page goes', () => {
    const el = scrollBox(document.createElement('div'), { height: 600 })
    restoreScroll(el, 1200)
    vi.advanceTimersByTime(2100)
    setHeight(el, 3000)
    vi.advanceTimersByTime(100)
    expect(el.scrollTop).toBe(100)
  })

  it('can be cancelled', () => {
    const el = scrollBox(document.createElement('div'), { height: 600 })
    const cancel = restoreScroll(el, 1200)
    cancel()
    setHeight(el, 3000)
    vi.advanceTimersByTime(100)
    expect(el.scrollTop).toBe(100)
  })
})

describe('the offsets across a reload', () => {
  beforeEach(() => sessionStorage.clear())

  it('are kept in the session, the newest entries only', () => {
    const offsets = new Map(Array.from({ length: 60 }, (_, i) => [`k${i}`, i * 10] as [string, number]))
    saveOffsets(offsets)
    const loaded = loadOffsets()
    expect(loaded.size).toBe(50)
    expect(loaded.get('k59')).toBe(590)
    expect(loaded.has('k0')).toBe(false)
  })

  it('start empty when the session holds nothing usable', () => {
    sessionStorage.setItem('admin-scroll-offsets', 'not json')
    expect(loadOffsets().size).toBe(0)
    sessionStorage.setItem('admin-scroll-offsets', JSON.stringify({ k: 'x' }))
    expect(loadOffsets().size).toBe(0)
    sessionStorage.setItem(
      'admin-scroll-offsets',
      JSON.stringify([
        ['a', 10],
        ['b', 'x'],
        [3, 4],
      ]),
    )
    expect([...loadOffsets()]).toEqual([['a', 10]])
  })
})

describe('useAdminScroll', () => {
  beforeEach(() => sessionStorage.clear())

  function Layout() {
    const main = useRef<HTMLElement>(null)
    useAdminScroll(main)
    return (
      <main ref={main} data-testid="main">
        <Outlet />
      </main>
    )
  }

  function List() {
    const location = useLocation()
    const [, setSearchParams] = useSearchParams()
    return (
      <>
        <Link to="/admin/stories/s1" state={{ from: location.key }}>
          Open story
        </Link>
        <button type="button" onClick={() => setSearchParams({ page: '2' })}>
          Next page
        </button>
      </>
    )
  }

  function Story() {
    const location = useLocation()
    const from = (location.state as { from?: string } | null)?.from
    return (
      <Link to="/admin/stories" state={from ? { restoreScrollOf: from } : undefined}>
        Back to stories
      </Link>
    )
  }

  function renderAdmin() {
    const router = createMemoryRouter(
      [
        {
          path: '/admin',
          element: <Layout />,
          children: [
            { path: 'stories', element: <List /> },
            { path: 'stories/:id', element: <Story /> },
          ],
        },
      ],
      { initialEntries: ['/admin/stories'] },
    )
    const result = render(<RouterProvider router={router} />)
    return { ...result, router, main: scrollBox(screen.getByTestId('main')) }
  }

  it('opens a story at the top and comes back to the list where it was, by browser Back or by the back link', async () => {
    const { router, main } = renderAdmin()
    scrollTo(main, 1200)

    await act(async () => screen.getByRole('link', { name: 'Open story' }).click())
    expect(main.scrollTop).toBe(0)

    await act(() => router.navigate(-1))
    expect(main.scrollTop).toBe(1200)

    await act(async () => screen.getByRole('link', { name: 'Open story' }).click())
    scrollTo(main, 400)
    await act(async () => screen.getByRole('link', { name: 'Back to stories' }).click())
    expect(main.scrollTop).toBe(1200)
  })

  it('keeps the offset when the list changes its page in the URL', async () => {
    const { main } = renderAdmin()
    scrollTo(main, 700)
    await act(async () => screen.getByRole('button', { name: 'Next page' }).click())
    expect(main.scrollTop).toBe(700)
  })

  it('keeps each entry’s offset in the session when the admin goes away', () => {
    const { unmount, main } = renderAdmin()
    scrollTo(main, 900)
    unmount()
    expect([...loadOffsets().values()]).toContain(900)
  })
})
