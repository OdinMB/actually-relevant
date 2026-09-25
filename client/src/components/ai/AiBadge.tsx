import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

interface AiBadgeProps {
  /**
   * Set when visible text next to the badge already says the content is AI-generated
   * (AiLabel, SiteAiNotice), so screen readers don't announce it twice.
   */
  decorative?: boolean
  /** What screen readers announce instead of the visible "AI". */
  accessibleName?: string
  className?: string
}

/** Takes its color from the surrounding text, so it keeps that text's contrast on light and dark backgrounds. */
const BADGE_CLASS =
  'inline-flex items-center rounded border border-current px-1 py-px text-[10px] font-bold leading-none tracking-wide'

/** Compact "AI" badge for AI-generated or AI-selected content (cards, hero, pull quotes). */
export default function AiBadge({
  decorative = false,
  accessibleName = AI_DISCLOSURE_COPY.badgeAccessibleName,
  className = '',
}: AiBadgeProps) {
  const classes = `${BADGE_CLASS} ${className}`.trim()

  if (decorative) {
    return (
      <span className={classes} aria-hidden="true">
        {AI_DISCLOSURE_COPY.badgeText}
      </span>
    )
  }

  return (
    <span className={classes}>
      <span aria-hidden="true">{AI_DISCLOSURE_COPY.badgeText}</span>
      <span className="sr-only">{accessibleName}</span>
    </span>
  )
}
