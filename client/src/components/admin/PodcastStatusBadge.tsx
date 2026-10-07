import type { PodcastListItem } from '@shared/types'
import { Badge } from '../ui/Badge'

export type PodcastPublication = 'published' | 'unpublished' | 'draft'

type PublicationFields = Pick<PodcastListItem, 'status' | 'publishedAt'>

/** Listed now; taken down after a first publication; or never published. */
export function podcastPublication(podcast: PublicationFields): PodcastPublication {
  if (podcast.status === 'published') return 'published'
  return podcast.publishedAt ? 'unpublished' : 'draft'
}

const LABELS: Record<PodcastPublication, string> = { published: 'Published', unpublished: 'Unpublished', draft: 'Draft' }

/** The episode's publication status, the same in the admin list and on the detail page. */
export function PodcastStatusBadge({ podcast }: { podcast: PublicationFields }) {
  const publication = podcastPublication(podcast)
  return <Badge variant={publication === 'published' ? 'green' : 'gray'}>{LABELS[publication]}</Badge>
}
