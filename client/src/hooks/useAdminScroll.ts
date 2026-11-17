import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation, useNavigationType, type NavigationType } from 'react-router-dom'

/*
 * The admin's scroll position per page. `<main>` is the admin's scroll box (the window never
 * scrolls), so the browser keeps nothing for it, and without this rule its offset carries over from
 * one page to the next. Each history entry's offset is remembered; a link to another path starts at
 * the top; browser Back or Forward puts the entry's offset back, as does a link whose state names
 * the entry to return to (`restoreScrollOf`, the story page's "Back to stories"); a change of the
 * search alone (a filter, a page of the list) keeps the offset. Offsets outlive a reload in
 * `sessionStorage`, so Back after reloading a story still finds the list where it was.
 */

const STORAGE_KEY = 'admin-scroll-offsets'
const KEPT_ENTRIES = 50
/** How long a restore waits for the page to grow tall enough (its rows may still be loading). */
const RESTORE_WAIT_MS = 2000
const RESTORE_STEP_MS = 50
/** What the person does that ends a restore still waiting: they have started scrolling themselves. */
const OWN_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

export type ScrollPlan = { restore: number } | 'top' | 'keep'

interface Arrival {
  type: NavigationType
  key: string
  pathname: string
  state: unknown
}

function restoreTarget(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const target = (state as { restoreScrollOf?: unknown }).restoreScrollOf
  return typeof target === 'string' ? target : undefined
}

/** What to do with the scroll offset on arriving at an entry, coming from `previousPathname` (null on the first load). */
export function scrollPlan(arrival: Arrival, previousPathname: string | null, offsets: ReadonlyMap<string, number>): ScrollPlan {
  const returnsTo = arrival.type === 'POP' ? arrival.key : restoreTarget(arrival.state)
  const saved = returnsTo === undefined ? undefined : offsets.get(returnsTo)
  if (saved !== undefined) return { restore: saved }
  if (previousPathname === null || previousPathname === arrival.pathname) return 'keep'
  return 'top'
}

/**
 * Scroll `el` to `top`, waiting while the page is too short to get there, until it is, the person
 * scrolls, or two seconds pass (then it stays as far down as the page goes). Returns a cancel.
 */
export function restoreScroll(el: HTMLElement, top: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const started = Date.now()
  const stop = () => {
    clearTimeout(timer)
    for (const type of OWN_SCROLL_EVENTS) el.removeEventListener(type, stop)
  }
  const step = () => {
    el.scrollTop = top
    if (el.scrollHeight - el.clientHeight >= top || Date.now() - started >= RESTORE_WAIT_MS) stop()
    else timer = setTimeout(step, RESTORE_STEP_MS)
  }
  for (const type of OWN_SCROLL_EVENTS) el.addEventListener(type, stop, { passive: true })
  step()
  return stop
}

/** The offsets kept in this tab's session, the newest last. */
export function loadOffsets(): Map<string, number> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) return new Map()
    return new Map(stored.filter((entry): entry is [string, number] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number'))
  } catch {
    return new Map()
  }
}

export function saveOffsets(offsets: ReadonlyMap<string, number>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...offsets].slice(-KEPT_ENTRIES)))
  } catch {
    // Storage full or switched off: offsets last until the tab reloads
  }
}

/** Apply the admin's scroll rule to its scroll box, `<main>` (`AdminLayout`). */
export function useAdminScroll(mainRef: RefObject<HTMLElement | null>): void {
  const location = useLocation()
  const navigationType = useNavigationType()
  // Read from the session on first use, in an effect; the key is the entry the offset belongs to
  const offsetsRef = useRef<Map<string, number> | null>(null)
  const currentKeyRef = useRef(location.key)
  const previousPathnameRef = useRef<string | null>(null)

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const offsets = (offsetsRef.current ??= loadOffsets())
    const onScroll = () => {
      // Re-inserted, so the newest entries stay last and survive the trim
      offsets.delete(currentKeyRef.current)
      offsets.set(currentKeyRef.current, el.scrollTop)
    }
    const persist = () => saveOffsets(offsets)
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', persist)
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', persist)
      persist()
    }
  }, [mainRef])

  // A layout effect, so the offset is set before the new page paints
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    const offsets = (offsetsRef.current ??= loadOffsets())
    currentKeyRef.current = location.key
    const plan = scrollPlan(
      { type: navigationType, key: location.key, pathname: location.pathname, state: location.state },
      previousPathnameRef.current,
      offsets,
    )
    previousPathnameRef.current = location.pathname
    if (plan === 'top') el.scrollTop = 0
    if (plan === 'keep' || plan === 'top') {
      offsets.set(location.key, el.scrollTop)
      return
    }
    offsets.set(location.key, plan.restore)
    return restoreScroll(el, plan.restore)
    // Runs once per arrival at an entry: every navigation brings a new key, type, path and state together
  }, [mainRef, location.key, location.pathname, location.state, navigationType])
}
