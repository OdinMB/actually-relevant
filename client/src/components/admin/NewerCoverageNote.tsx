import { Link, useLocation } from 'react-router-dom'
import type { StoryNewerCoverage } from '@shared/types'
import { formatShortDate } from '../../lib/constants'
import { TEXT_LINK } from '../../lib/control-classes'
import { returnState, storyPath } from './storyReturn'

const REASON: Record<StoryNewerCoverage['newer'][number]['reason'], string> = {
  same_event: 'same event',
  same_source: 'same publisher',
}

/** Advisory, under a chosen story: later stories that may have overtaken it, each linked to its admin page (which comes back here). Blocks nothing. */
export function NewerCoverageNote({ newer }: { newer: StoryNewerCoverage['newer'] }) {
  const location = useLocation()
  if (newer.length === 0) return null
  return (
    <p className="mt-1 text-xs text-amber-800">
      <span className="font-medium">Newer coverage:</span>{' '}
      {newer.map((story, i) => (
        <span key={story.id}>
          {i > 0 && '; '}
          <Link to={storyPath(story.id)} state={returnState(location)} className={TEXT_LINK}>
            {story.title}
          </Link>{' '}
          <span className="text-neutral-600">
            ({story.publisher}, {formatShortDate(story.reportedAt)}, {REASON[story.reason]})
          </span>
        </span>
      ))}
    </p>
  )
}
