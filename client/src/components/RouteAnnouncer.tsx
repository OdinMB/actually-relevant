import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { whenPageSettles } from '../lib/pageSettled'
import { ROUTE_FALLBACK_ATTR } from '../lib/renderComplete'

/** The admin keeps its own focus handling; this is for the public site. */
const ADMIN_PATH = /^\/admin(?:\/|$)/

/**
 * Focuses the page's `<main>` without scrolling, so a `#hash` target stays in view. It is focusable
 * only while it holds that focus: a lasting `tabindex` would make every click on its text focus it,
 * and the next Tab would then start over at the top instead of after the click.
 */
function focusMain() {
  const main = document.querySelector<HTMLElement>('main')
  if (!main) return
  if (!main.hasAttribute('tabindex')) {
    main.setAttribute('tabindex', '-1')
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
  }
  main.focus({ preventScroll: true })
}

/**
 * Tells a screen reader that an in-app link opened another page, as a page load would (WCAG 2.4.3,
 * 4.1.3): focus moves to the page's `<main>`, and once the page has loaded its chunk and data, a
 * polite live region reads its title. Only a change of path counts: the query string (the mix
 * slider, filters, pagination) and the hash (in-page links) leave focus where it is. The first page
 * load is the browser's to announce, and so is a redirect while it loads (`<Navigate replace>`, a
 * story's cluster redirect).
 */
export default function RouteAnnouncer() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const queryClient = useQueryClient()
  const [newPage, setNewPage] = useState<{ pathname: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const lastPathname = useRef(pathname)
  const navigated = useRef(false)

  // Each new page is a new object, so a path visited again counts again
  useEffect(() => {
    if (pathname === lastPathname.current) return
    lastPathname.current = pathname
    if (navigationType === 'REPLACE' && !navigated.current) return
    navigated.current = true
    setNewPage({ pathname })
  }, [pathname, navigationType])

  useEffect(() => {
    if (!newPage || ADMIN_PATH.test(newPage.pathname)) return
    focusMain()
    // Emptied first, so a title the same as the last one is announced too
    setAnnouncement('')
    return whenPageSettles(() => setAnnouncement(document.title), {
      isBusy: () => document.querySelector(`[${ROUTE_FALLBACK_ATTR}]`) !== null || queryClient.isFetching() > 0,
    })
  }, [newPage, queryClient])

  return (
    <div role="status" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  )
}
