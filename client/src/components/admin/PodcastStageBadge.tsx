import type { PodcastListItem, PodcastStage } from '@shared/types'
import type { BadgeVariant } from '../../lib/constants'
import { Badge } from '../ui/Badge'

const STAGES: Record<PodcastStage, { label: string; variant: BadgeVariant }> = {
  legacy: { label: 'Legacy', variant: 'gray' },
  created: { label: 'Created', variant: 'gray' },
  scripted: { label: 'Scripted', variant: 'blue' },
  voiced: { label: 'Voiced', variant: 'purple' },
  ready: { label: 'Ready', variant: 'green' },
}

/** The episode's production stage, with "in progress" while a process holds its lease and "blocked" until a Resume. */
export function PodcastStageBadge({ podcast }: { podcast: Pick<PodcastListItem, 'stage' | 'inProgress' | 'blockedAt'> }) {
  const stage = STAGES[podcast.stage]
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={stage.variant}>{stage.label}</Badge>
      {podcast.inProgress && <Badge variant="yellow">In progress</Badge>}
      {podcast.blockedAt && <Badge variant="red">Blocked</Badge>}
    </span>
  )
}
