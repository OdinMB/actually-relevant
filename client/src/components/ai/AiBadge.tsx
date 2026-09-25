import { AI_DISCLOSURE_COPY } from './aiDisclosureCopy'

interface AiBadgeProps {
  /**
   * Set when visible text next to the badge already says the content is AI-generated
   * (AiLabel, SiteAiNotice), so screen readers don't announce it twice.
   */
  decorative?: boolean
  className?: string
}

const BADGE_CLASS =
  'inline-flex items-center rounded border border-neutral-400 px-1 py-px text-[10px] font-bold leading-none tracking-wide text-neutral-600'

/** Compact "AI" badge for AI-generated content (cards, hero, pull quotes). Unmounted pending copy review. */
export default function AiBadge({ decorative = false, className = '' }: AiBadgeProps) {
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
      <span className="sr-only">{AI_DISCLOSURE_COPY.badgeAccessibleName}</span>
    </span>
  )
}
