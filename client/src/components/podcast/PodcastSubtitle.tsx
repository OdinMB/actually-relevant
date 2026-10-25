import AiBadge from '../ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'

const { lead, tail } = AI_DISCLOSURE_COPY.podcastSubtitle

/**
 * The podcast subtitle with the "AI" badge inline as its only "AI". Screen readers hear the
 * badge as the word "AI", so the sentence reads the same aloud.
 */
export default function PodcastSubtitle({ className = 'page-intro' }: { className?: string }) {
  return (
    <p className={className} data-podcast-subtitle>
      {lead}{' '}
      <AiBadge accessibleName={AI_DISCLOSURE_COPY.badgeText} className="align-middle text-neutral-700" />
      {tail}
    </p>
  )
}
