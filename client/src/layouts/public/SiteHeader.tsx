import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSavedCount } from '../../hooks/useSavedCount'
import { useThisWeekIssuePath } from '../../hooks/useNewsletterArchive'
import { MoodDialPanel } from '../../components/PositivitySlider'
import BrandLogo from '../../components/BrandLogo'
import IssueNav from './IssueNav'
import MobileMenu from './MobileMenu'
import SearchPanel from './SearchPanel'
import { NewsletterIcon, PodcastIcon, SavedIcon, SearchIcon, ThisWeekIcon } from './icons'

/** Class for the desktop header actions (This week, Newsletter, Podcast, Saved) beside the logo. */
const HEADER_ACTION_LINK =
  'inline-flex items-center gap-1.5 text-base font-normal tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-2 py-1 text-neutral-500 hover:text-brand-700'

/**
 * Their icons, left out while Saved is shown: four links with icons reach under the centered logo
 * on a 1024px screen and crowd it at full width, while as text they clear it. Saved is known on
 * the client's first render, so the icons go then (a prerendered page, which has no Saved, shows
 * them until the script starts) or when the reader saves a first story, and never later on their
 * own (This week, which arrives later, moves none of the others).
 */
const headerActionIcon = (savedShown: boolean) => (savedShown ? 'hidden' : 'w-4 h-4 shrink-0')

/**
 * The site header: logo bar with its actions, the desktop issue nav, the
 * mobile menu dialog and the search panel. Owns the menu and search state.
 */
export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const savedCount = useSavedCount()
  const thisWeekPath = useThisWeekIssuePath()
  const actionIcon = headerActionIcon(savedCount > 0)
  const { pathname } = useLocation()

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // Close search on route change
  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [pathname])

  return (
    <header>
      {/* Logo bar — centered logo, engagement actions right */}
      <div className="bg-white border-b border-neutral-100">
        <div className="max-w-6xl mx-auto px-4 py-3 md:py-4 flex items-start justify-center relative">
          {/* Logo */}
          <BrandLogo />

          {/* Desktop: Mood Dial — vertically centered on logo (top matches py-4, h matches logo h-16) */}
          <div className="hidden lg:flex items-center absolute left-12 top-4 h-16">
            <MoodDialPanel />
          </div>

          {/* Desktop: this week, newsletter, podcast, saved — vertically centered on logo */}
          <div className="hidden lg:flex items-center gap-1 absolute right-12 top-4 h-16">
            {/* Only once this week's issue is known. First, so its arrival (after the page) moves
                none of the links in this right-anchored group */}
            {thisWeekPath && (
              <Link to={thisWeekPath} className={HEADER_ACTION_LINK}>
                <ThisWeekIcon className={actionIcon} />
                This week
              </Link>
            )}
            <Link to="/newsletter" className={HEADER_ACTION_LINK}>
              <NewsletterIcon className={actionIcon} />
              Newsletter
            </Link>
            <Link to="/podcast" className={HEADER_ACTION_LINK}>
              <PodcastIcon className={actionIcon} />
              Podcast
            </Link>
            {/* Only once a story is saved (useSavedCount follows every save and removal) */}
            {savedCount > 0 && (
              <Link to="/saved" className={HEADER_ACTION_LINK}>
                <SavedIcon className={actionIcon} />
                Saved ({savedCount})
              </Link>
            )}
          </div>

          {/* Mobile: search on left, menu on right — vertically centered on logo */}
          <div className="lg:hidden absolute left-4 top-3 md:top-4 h-14 md:h-16 flex items-center">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen)
                setMenuOpen(false)
              }}
              className={`p-2 rounded transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                searchOpen ? 'text-brand-700' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              aria-label={searchOpen ? 'Close search' : 'Open search'}
              aria-expanded={searchOpen}
              aria-controls="search-panel"
            >
              <SearchIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="lg:hidden absolute right-4 top-3 md:top-4 h-14 md:h-16 flex items-center">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Issue category navigation — desktop */}
      <IssueNav searchOpen={searchOpen} onToggleSearch={() => setSearchOpen(!searchOpen)} />

      {/* Mobile nav — dialog for built-in focus trap */}
      <MobileMenu open={menuOpen} onClose={closeMenu} savedCount={savedCount} thisWeekPath={thisWeekPath} />

      {/* Search bar */}
      {searchOpen && <SearchPanel query={searchQuery} onQueryChange={setSearchQuery} onClose={closeSearch} />}
    </header>
  )
}
