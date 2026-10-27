import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getCategoryColor } from '../../lib/category-colors'
import { KOFI_URL } from '../../config'
import { MoodDialPanel } from '../../components/PositivitySlider'
import BrandLogo from '../../components/BrandLogo'
import { ISSUE_LINKS, isActiveIssue } from './navLinks'
import { CategoryColorStrip, HeartIcon, NewsletterIcon, PodcastIcon, SavedIcon, ThisWeekIcon } from './icons'

/** Class for each action link (This week, Newsletter, Podcast, Saved, Support) in the mobile menu. */
const MENU_ACTION_LINK =
  'flex items-center gap-2 py-2.5 text-sm font-bold text-brand-700 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
  savedCount: number
  /** This week's issue's web edition, or null to leave the link out (`useThisWeekIssuePath`). */
  thisWeekPath: string | null
}

/** Full-screen mobile navigation in a native <dialog>, for its built-in focus trap. */
export default function MobileMenu({ open, onClose, savedCount, thisWeekPath }: MobileMenuProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { pathname } = useLocation()

  // Sync the dialog with the open state
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [open])

  // Handle dialog cancel (Escape key / native close)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      id="mobile-nav-menu"
      className="lg:hidden fixed top-0 left-0 w-full h-[100dvh] max-w-none max-h-none m-0 p-0 bg-transparent backdrop:bg-transparent overflow-hidden open:flex open:flex-col"
      aria-label="Mobile navigation"
    >
      {/* Dialog header: logo + close + color strip */}
      <div className="bg-white">
        <div className="border-b border-neutral-100 px-4 py-3 md:py-4 flex items-start justify-center relative">
          <BrandLogo onClick={onClose} />
          <div className="absolute right-4 top-3 md:top-4 h-14 md:h-16 flex items-center">
            <button onClick={onClose} className="p-2 rounded focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Close menu">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <CategoryColorStrip />
      </div>
      <div className="bg-white border-b border-neutral-200 shadow-lg">
        <nav className="px-4 py-3">
          {/* Mood Dial — centered */}
          <div className="mb-3 py-2 flex justify-center">
            <MoodDialPanel />
          </div>

          {/* Issue categories */}
          <ul className="mb-3 border-t border-neutral-100 pt-3">
            {ISSUE_LINKS.map(link => {
              const colors = getCategoryColor(link.slug)
              return (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    onClick={onClose}
                    className={`flex items-center gap-2 py-2.5 text-sm font-bold focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-2 ${
                      isActiveIssue(pathname, link.href) ? 'text-neutral-900' : 'text-neutral-600 hover:text-neutral-900'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${colors.dotBg}`} aria-hidden="true" />
                    {link.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* This week, Newsletter, Podcast, Saved & Support — each on its own line */}
          <div className="border-t border-neutral-100 pt-3 px-2 flex flex-col">
            {thisWeekPath && (
              <Link to={thisWeekPath} onClick={onClose} className={MENU_ACTION_LINK}>
                <ThisWeekIcon className="w-3.5 h-3.5 shrink-0" />
                This week
              </Link>
            )}
            <Link to="/newsletter" onClick={onClose} className={MENU_ACTION_LINK}>
              <NewsletterIcon className="w-3.5 h-3.5 shrink-0" />
              Newsletter
            </Link>
            <Link to="/podcast" onClick={onClose} className={MENU_ACTION_LINK}>
              <PodcastIcon className="w-3.5 h-3.5 shrink-0" />
              Podcast
            </Link>
            {savedCount > 0 && (
              <Link to="/saved" onClick={onClose} className={MENU_ACTION_LINK}>
                <SavedIcon className="w-3.5 h-3.5 shrink-0" />
                Saved Stories ({savedCount})
              </Link>
            )}
            <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" className={MENU_ACTION_LINK}>
              <HeartIcon className="w-3.5 h-3.5 shrink-0" />
              Support Us
              <span className="sr-only">(opens in new tab)</span>
            </a>
          </div>
        </nav>
      </div>
      {/* Tap-to-close area below menu */}
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden="true" />
    </dialog>
  )
}
