import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSavedCount } from "../../hooks/useSavedCount";
import { MoodDialPanel } from "../../components/PositivitySlider";
import BrandLogo from "../../components/BrandLogo";
import IssueNav from "./IssueNav";
import MobileMenu from "./MobileMenu";
import SearchPanel from "./SearchPanel";
import { NewsletterIcon, PodcastIcon, SavedIcon, SearchIcon } from "./icons";

/** Class for the desktop header actions (Newsletter, Podcast, Saved) beside the logo. */
const HEADER_ACTION_LINK =
  "inline-flex items-center gap-1.5 text-base font-normal tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-2 py-1 text-neutral-500 hover:text-brand-700";

/**
 * The site header: logo bar with its actions, the desktop issue nav, the
 * mobile menu dialog and the search panel. Owns the menu and search state.
 */
export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const savedCount = useSavedCount();
  const { pathname } = useLocation();

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Close search on route change
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, [pathname]);

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

          {/* Desktop: newsletter, podcast, saved — vertically centered on logo */}
          <div className="hidden lg:flex items-center gap-1 absolute right-12 top-4 h-16">
            <Link
              to="/newsletter"
              className={HEADER_ACTION_LINK}
            >
              <NewsletterIcon className="w-4 h-4 shrink-0" />
              Newsletter
            </Link>
            <Link
              to="/podcast"
              className={HEADER_ACTION_LINK}
            >
              <PodcastIcon className="w-4 h-4 shrink-0" />
              Podcast
            </Link>
            {/* Only once a story is saved (useSavedCount follows every save and removal) */}
            {savedCount > 0 && (
              <Link
                to="/saved"
                className={HEADER_ACTION_LINK}
              >
                <SavedIcon className="w-4 h-4 shrink-0" />
                Saved ({savedCount})
              </Link>
            )}
          </div>

          {/* Mobile: search on left, menu on right — vertically centered on logo */}
          <div className="lg:hidden absolute left-4 top-3 md:top-4 h-14 md:h-16 flex items-center">
            <button
              onClick={() => {
                setSearchOpen(!searchOpen);
                setMenuOpen(false);
              }}
              className={`p-2 rounded transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
                searchOpen
                  ? "text-brand-700"
                  : "text-neutral-400 hover:text-neutral-600"
              }`}
              aria-label={searchOpen ? "Close search" : "Open search"}
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
              aria-label={menuOpen ? "Close menu" : "Open menu"}
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                {menuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Issue category navigation — desktop */}
      <IssueNav
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen(!searchOpen)}
      />

      {/* Mobile nav — dialog for built-in focus trap */}
      <MobileMenu
        open={menuOpen}
        onClose={closeMenu}
        savedCount={savedCount}
      />

      {/* Search bar */}
      {searchOpen && (
        <SearchPanel
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClose={closeSearch}
        />
      )}
    </header>
  );
}
