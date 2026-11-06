import type { MouseEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { isUpliftingPath, withMix } from '../../contexts/PositivityContext'
import { focusWithoutTabStop } from '../../lib/focusTarget'

/** A plain primary click, which the app follows itself; a modified or non-primary one opens a new tab or window. */
function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * The Actually Uplifting edition's one way out, in its row and its dialog: "See all news" sets the
 * balanced mix and keeps the address's other parameters. On any page it stays on that page, hash
 * included, and replaces the history entry, as the slider does; on the landing page it goes to the
 * homepage as a new entry, since the reader is leaving the edition's page.
 *
 * Following it ends the edition and the row goes, this link with it, so focus would fall to
 * `<body>` (WCAG 2.4.3): a plain click moves focus to `<main>` first. In a modal dialog the page
 * around it is inert and `<main>` cannot take focus, so the dialog is closed first and `onFollow`
 * brings its owner's state along. A modified or non-primary click opens a new tab or window
 * instead, and this page, dialog and focus included, stays as it was.
 */
export default function SeeAllNewsLink({ className, onFollow }: { className: string; onFollow?: () => void }) {
  const { pathname, hash } = useLocation()
  const [searchParams] = useSearchParams()

  const onLandingPage = isUpliftingPath(pathname)
  const search = `?${withMix(searchParams, 50)}`
  const to = onLandingPage ? { pathname: '/', search } : { pathname, search, hash }

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return
    event.currentTarget.closest('dialog')?.close()
    const main = document.querySelector<HTMLElement>('main')
    if (main) focusWithoutTabStop(main, { preventScroll: true })
    onFollow?.()
  }

  return (
    <Link to={to} replace={!onLandingPage} preventScrollReset={!onLandingPage} onClick={onClick} className={className}>
      See all news
    </Link>
  )
}
