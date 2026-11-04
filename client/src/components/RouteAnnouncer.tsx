import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { whenPageSettles } from '../lib/pageSettled'
import { ROUTE_FALLBACK_ATTR } from '../lib/renderComplete'
import { focusWithoutTabStop } from '../lib/focusTarget'
import { useAnnouncement } from '../hooks/useAnnouncement'

/** The admin keeps its own focus handling; this is for the public site. */
const ADMIN_PATH = /^\/admin(?:\/|$)/

/** The section a link's `#hash` names, once it is on the page. */
function hashTarget(hash: string): HTMLElement | null {
  return hash.length > 1 ? document.getElementById(hash.slice(1)) : null
}

/**
 * Focus for a page an in-app link just opened: the section its `#hash` names when that is already on
 * the page, as a browser's own hash link does (scrolled into view), else the page's `<main>`, without
 * scrolling, since PublicLayout has already put the page at its top.
 */
function focusNewPage(hash: string) {
  const target = hashTarget(hash)
  if (target) {
    focusWithoutTabStop(target)
    return
  }
  const main = document.querySelector<HTMLElement>('main')
  if (main) focusWithoutTabStop(main, { preventScroll: true })
}

/**
 * Once the page has loaded, the `#hash` section that came with its data takes the focus `<main>`
 * held in the meantime; never focus the reader moved on their own.
 */
function focusLateHashTarget(hash: string) {
  const target = hashTarget(hash)
  if (!target || document.activeElement === target) return
  const active = document.activeElement
  if (active === null || active === document.body || active === document.querySelector('main')) focusWithoutTabStop(target)
}

/**
 * Tells a screen reader that an in-app link opened another page, as a page load would (WCAG 2.4.3,
 * 4.1.3): focus moves to the page's `<main>` (or to the section the link's `#hash` names), and once
 * the page has loaded its chunk and data, a polite live region reads its title, then empties again a
 * few seconds later. Only a change of path counts: the query string (the mix slider, filters,
 * pagination) and the hash alone (in-page links) leave focus where it is. The first page load is
 * the browser's to announce, and so is a redirect while it loads (`<Navigate replace>`, a story's
 * cluster redirect). The admin pages get neither, and an announcement still showing is taken away.
 */
export default function RouteAnnouncer() {
  const { pathname, hash } = useLocation()
  const navigationType = useNavigationType()
  const queryClient = useQueryClient()
  const [newPage, setNewPage] = useState<{ pathname: string; hash: string } | null>(null)
  const { text, announce, clear } = useAnnouncement()
  const lastPathname = useRef(pathname)
  const navigated = useRef(false)

  // Each new page is a new object, so a path visited again counts again
  useEffect(() => {
    if (pathname === lastPathname.current) return
    lastPathname.current = pathname
    if (navigationType === 'REPLACE' && !navigated.current) return
    navigated.current = true
    setNewPage({ pathname, hash })
  }, [pathname, hash, navigationType])

  useEffect(() => {
    if (!newPage) return
    // Emptied first, so a title the same as the last one is announced too
    clear()
    if (ADMIN_PATH.test(newPage.pathname)) return
    focusNewPage(newPage.hash)
    return whenPageSettles(
      () => {
        focusLateHashTarget(newPage.hash)
        announce(document.title)
      },
      {
        isBusy: () => document.querySelector(`[${ROUTE_FALLBACK_ATTR}]`) !== null || queryClient.isFetching() > 0,
      },
    )
  }, [newPage, queryClient, clear, announce])

  return (
    <div role="status" aria-atomic="true" className="sr-only">
      {text}
    </div>
  )
}
