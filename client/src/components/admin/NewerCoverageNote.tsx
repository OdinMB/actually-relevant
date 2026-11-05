import { Link } from 'react-router-dom'
import type { StoryNewerCoverage } from '@shared/types'
import { formatShortDate } from '../../lib/constants'
import { TEXT_LINK } from '../../lib/control-classes'

const REASON: Record<StoryNewerCoverage['newer'][number]['reason'], string> = {
  same_event: 'same event',
  same_source: 'same publisher',
}

/** Advisory, under a chosen story: later stories that may have overtaken it, each linked to its admin page. Blocks nothing. */
export function NewerCoverageNote({ newer }: { newer: StoryNewerCoverage['newer'] }) {
  if (newer.length === 0) return null
  return (
    <p className="mt-1 text-xs text-amber-800">
      <span className="font-medium">Newer coverage:</span>{' '}
      {newer.map((story, i) => (
        <span key={story.id}>
          {i > 0 && '; '}
          <Link to={`/admin/stories/${story.id}`} className={TEXT_LINK}>
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
