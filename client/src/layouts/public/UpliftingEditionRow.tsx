import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { isUpliftingPath, useUpliftingEdition, withMix } from '../../contexts/PositivityContext'
import { TEXT_LINK } from '../../lib/control-classes'
import { focusWithoutTabStop } from '../../lib/focusTarget'

/** Where focus goes when the link is clicked: the link leaves with the row, and focus would fall to `<body>` (WCAG 2.4.3). */
function focusMain() {
  const main = document.querySelector<HTMLElement>('main')
  if (main) focusWithoutTabStop(main, { preventScroll: true })
}

/**
 * The Actually Uplifting edition's cue under the logo bar, shown only while the dial is at
 * "Only uplifting", with its one way out: "See all news" sets the balanced mix and keeps the
 * address's other parameters. On any page it stays on that page and replaces the history entry,
 * as the slider does; on the landing page it goes to the homepage as a new entry, since the reader
 * is leaving the edition's page. One line at 390px; narrower, it wraps onto two centered lines
 * (the link kept whole), never cut off, so it reflows down to 320px.
 */
export default function UpliftingEditionRow() {
  const inEdition = useUpliftingEdition()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  if (!inEdition) return null

  const onLandingPage = isUpliftingPath(pathname)
  const to = { pathname: onLandingPage ? '/' : pathname, search: `?${withMix(searchParams, 50)}` }

  return (
    <div className="bg-brand-50 border-b border-brand-100">
      <p className="max-w-6xl mx-auto px-4 py-2 text-center text-sm">
        <strong className="text-brand-700">Only positive news from Actually Relevant.</strong>{' '}
        <Link to={to} replace={!onLandingPage} preventScrollReset={!onLandingPage} onClick={focusMain} className={`${TEXT_LINK} whitespace-nowrap`}>
          See all news
        </Link>
      </p>
    </div>
  )
}
