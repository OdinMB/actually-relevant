import { useCallback, useEffect, useState, type RefObject } from 'react'
import { focusWithoutTabStop } from '../lib/focusTarget'
import { useAnnouncement } from './useAnnouncement'

interface PageTurnOptions {
  /** The heading over the list: it stays on screen while the list changes, so focus goes there. */
  heading: RefObject<HTMLElement | null>
  /** The page the reader asked for last, and how many there are. */
  page: number
  totalPages: number
  /** True while the list shows that page's own items: not a skeleton, a failure, or the previous page kept in place while the next loads. */
  settled: boolean
}

/**
 * Another page of a public list, picked in its `Pagination` (WCAG 2.4.3, 4.1.3): focus moves to the
 * list's heading, since the button that had it may not survive the change, and once the new page's
 * items are in, a polite live region says which page shows ("Page 2 of 5"), as `RouteAnnouncer`
 * does for a new page. The caller scrolls (focus here does not), calls `turned(page)` from
 * `onPageChange`, and renders `announcement` in a `role="status"` that is always on the page.
 */
export function usePageTurn({ heading, page, totalPages, settled }: PageTurnOptions) {
  const { text, announce, clear } = useAnnouncement()
  const [awaited, setAwaited] = useState<number | null>(null)

  const turned = useCallback(
    (next: number) => {
      // Emptied first, so the same line is announced again after a turn back and forth
      clear()
      setAwaited(next)
      if (heading.current) focusWithoutTabStop(heading.current, { preventScroll: true })
    },
    [heading, clear],
  )

  useEffect(() => {
    if (awaited === null || awaited !== page || !settled) return
    setAwaited(null)
    announce(`Page ${page} of ${totalPages}`)
  }, [awaited, page, totalPages, settled, announce])

  return { turned, announcement: text }
}
