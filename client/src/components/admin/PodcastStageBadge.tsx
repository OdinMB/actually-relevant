import type { PodcastListItem, PodcastStage } from '@shared/types'
import type { BadgeVariant } from '../../lib/constants'
import { Badge } from '../ui/Badge'

const STAGES: Record<PodcastStage, { label: string; variant: BadgeVariant }> = {
  legacy: { label: 'Legacy', variant: 'gray' },
  created: { label: 'Created', variant: 'gray' },
  selected: { label: 'Stories selected', variant: 'blue' },
  scripted: { label: 'Scripted', variant: 'blue' },
  voiced: { label: 'Voiced', variant: 'purple' },
  ready: { label: 'Ready', variant: 'green' },
}

type BadgeFields = Pick<PodcastListItem, 'stage' | 'inProgress' | 'blockedAt' | 'awaitingReview'>

/**
 * The episode's production stage, with "in progress" while a process holds its lease, "awaiting
 * review" while an interactive episode waits for a person, and "blocked" until a Resume.
 */
export function PodcastStageBadge({ podcast }: { podcast: BadgeFields }) {
  const stage = STAGES[podcast.stage]
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={stage.variant}>{stage.label}</Badge>
      {podcast.inProgress && <Badge variant="yellow">In progress</Badge>}
      {podcast.awaitingReview && <Badge variant="orange">Awaiting review</Badge>}
      {podcast.blockedAt && <Badge variant="red">Blocked</Badge>}
    </span>
  )
}
