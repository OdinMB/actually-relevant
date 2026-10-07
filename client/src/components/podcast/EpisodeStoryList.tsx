import { Link } from 'react-router-dom'
import type { PublicPodcastEpisode } from '@shared/types'

export const PODCAST_LINK_CLASS = 'text-brand-700 underline hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded'

/**
 * An episode's stories in order: the title links to our story page (when it has one), then the
 * publisher and a link to the source. `id` and `hidden` let a disclosure toggle control the list.
 */
export default function EpisodeStoryList({ stories, id, hidden }: {
  stories: PublicPodcastEpisode['stories']
  id?: string
  hidden?: boolean
}) {
  return (
    <ol id={id} hidden={hidden} className="mt-2 list-decimal pl-5 space-y-1 text-neutral-700">
      {stories.map(story => (
        <li key={story.sourceUrl}>
          {story.slug ? <Link to={`/stories/${story.slug}`} className={PODCAST_LINK_CLASS}>{story.title}</Link> : story.title}
          {' '}({story.publisher},{' '}
          <a href={story.sourceUrl} className={PODCAST_LINK_CLASS} rel="noopener noreferrer" target="_blank">source</a>)
        </li>
      ))}
    </ol>
  )
}
