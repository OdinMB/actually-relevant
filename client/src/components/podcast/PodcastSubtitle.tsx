import AiSubtitle from '../ai/AiSubtitle'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'

/** The podcast subtitle with the "AI" badge inline as its only "AI" (`AiSubtitle`). */
export default function PodcastSubtitle({ className = 'page-intro' }: { className?: string }) {
  return <AiSubtitle copy={AI_DISCLOSURE_COPY.podcastSubtitle} className={className} />
}
