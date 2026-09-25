import type { PublicStory } from '@shared/types'
import { getTitleLabel } from '../lib/title-label'
import AiBadge from './ai/AiBadge'

/**
 * Title-label row above a story headline in cards and the homepage hero: the "AI" badge
 * (announced as "AI-generated") and the AI-written topic label. The badge shows even when
 * a story has no label, because the headline and summary next to it are AI-written.
 */
export default function StoryTitleLabel({
  story,
  className = '',
}: {
  story: Pick<PublicStory, 'titleLabel' | 'title' | 'sourceTitle'>
  className?: string
}) {
  const label = getTitleLabel(story)
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-500 ${className}`.trim()}
    >
      {/* The space separates the badge's accessible name from the label; flex layout doesn't render it */}
      <AiBadge />{' '}
      {label && <span>{label}</span>}
    </span>
  )
}
