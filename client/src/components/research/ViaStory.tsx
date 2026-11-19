import { Link } from 'react-router-dom'
import type { PublicOverviewLink } from '@shared/types'
import { TEXT_LINK } from '../../lib/control-classes'
import AiBadge from '../ai/AiBadge'

/**
 * "via our story [AI] <headline>": the story of ours an ongoing story's source came through, linked.
 * Its headline is AI-written, so it carries the badge, as on every story card.
 */
export function ViaStory({ story, className = '' }: { story: PublicOverviewLink; className?: string }) {
  return (
    <p className={className}>
      via our story <AiBadge className="mx-0.5 align-middle" />{' '}
      <Link to={`/stories/${encodeURIComponent(story.slug)}`} className={TEXT_LINK}>
        {story.title}
      </Link>
    </p>
  )
}
