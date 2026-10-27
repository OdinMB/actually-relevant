import { useState, useEffect } from 'react'
import { isSaved, toggleSaved } from '../lib/preferences'
import { ROW_ICON_TARGET } from '../lib/control-classes'

interface BookmarkButtonProps {
  slug: string
  size?: 'sm' | 'md'
  /** On desktop (lg+): show only on hover unless bookmarked. On mobile/tablet: always visible. */
  hoverReveal?: boolean
  /**
   * 'corner' (default): beside a card's title, the icon level with the title label. Below `md` an
   * invisible `::after` carries the hit area to 44x44, into the card's padding and the gap before
   * the title, so nothing moves. 'row': one of a row of icon actions (`ROW_ICON_TARGET`).
   */
  placement?: 'corner' | 'row'
  className?: string
}

/**
 * The corner box per size, with the icon at its top so it lines up with the title label text, and
 * how far the phone hit area reaches past it: 4px toward the title (the narrowest gap a card leaves,
 * `gap-1`), the rest up, down and into the card's padding on the right.
 */
const CORNER = {
  sm: 'w-6 h-6 max-md:after:-inset-y-2.5 max-md:after:-left-1 max-md:after:-right-4',
  md: 'w-8 h-8 pt-0.5 max-md:after:-inset-y-1.5 max-md:after:-left-1 max-md:after:-right-2',
} as const

export default function BookmarkButton({ slug, size = 'sm', hoverReveal = false, placement = 'corner', className = '' }: BookmarkButtonProps) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSaved(isSaved(slug))
  }, [slug])

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const nowSaved = toggleSaved(slug)
    setSaved(nowSaved) // toggleSaved notifies the header and SavedPage itself
  }

  const iconSize = size === 'md' ? 'w-5 h-5' : 'w-4 h-4'
  const box = placement === 'row' ? ROW_ICON_TARGET : `relative inline-flex justify-center items-start max-md:after:absolute ${CORNER[size]}`

  // When hoverReveal: desktop-only hover reveal unless bookmarked (saved items always visible)
  const visibilityClass = hoverReveal && !saved ? 'lg:opacity-0 lg:group-hover:opacity-100 transition-opacity' : 'transition-opacity'

  return (
    <button
      onClick={handleToggle}
      className={`${box} rounded transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ${
        saved ? 'text-brand-600 hover:text-brand-700' : 'text-neutral-500 hover:text-neutral-700'
      } ${visibilityClass} ${className}`}
      aria-label={saved ? 'Remove bookmark' : 'Bookmark story'}
      title={saved ? 'Remove bookmark' : 'Bookmark'}
    >
      <svg className={iconSize} viewBox="0 2 24 22" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    </button>
  )
}
