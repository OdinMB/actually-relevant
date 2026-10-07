import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { PublicPodcastEpisodeDetail, PublicPodcastTranscriptSegment } from '@shared/types'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema, buildPodcastEpisodeSchema } from '../lib/structured-data'
import { formatEpisodeDate, formatEpisodeDuration, podcastTranscriptPath } from '../lib/podcast'
import StructuredData from '../components/StructuredData'
import AiBadge from '../components/ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import EpisodeStoryList, { PODCAST_LINK_CLASS } from '../components/podcast/EpisodeStoryList'
import { usePodcastEpisode } from '../hooks/usePodcastEpisodes'

const BACK_LINK_CLASS = 'text-brand-700 hover:text-brand-800 font-normal focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1'

function BackToPodcast() {
  return <Link to="/podcast" className={BACK_LINK_CLASS}>&larr; All episodes</Link>
}

function EpisodeHead({ episode }: { episode: PublicPodcastEpisodeDetail }) {
  const url = `${SEO.siteUrl}${podcastTranscriptPath(episode.id)}`
  const title = `Transcript: ${episode.title} - ${SEO.siteName}`
  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={episode.summary.slice(0, 160)} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={episode.summary.slice(0, 200)} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="article:published_time" content={episode.publishedAt} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData data={buildPodcastEpisodeSchema(episode)} />
      <StructuredData
        data={buildBreadcrumbSchema([
          { name: 'Home', url: SEO.siteUrl },
          { name: 'Podcast', url: `${SEO.siteUrl}/podcast` },
          { name: episode.title },
        ])}
      />
    </>
  )
}

/** One part of the conversation: the story heading (if it is about a story), then one paragraph per turn. */
function TranscriptSegment({ segment }: { segment: PublicPodcastTranscriptSegment }) {
  const { story } = segment
  return (
    <div className="space-y-3">
      {story && (
        <h3 className="pt-4 text-lg font-semibold text-neutral-900">
          {story.slug ? <Link to={`/stories/${story.slug}`} className={PODCAST_LINK_CLASS}>{story.title}</Link> : story.title}
        </h3>
      )}
      {segment.turns.map((turn, i) => (
        <p key={i} data-transcript-turn className="text-neutral-800 leading-relaxed">
          <span className="font-semibold text-neutral-900">{turn.speaker}:</span> {turn.text}
        </p>
      ))}
    </div>
  )
}

function NotFound() {
  return (
    <div className="page-section text-center">
      <Helmet>
        <meta name="robots" content="noindex" />
      </Helmet>
      <h1 className="page-title">Episode Not Found</h1>
      <p className="text-neutral-500 mb-6">This episode may have been taken down or is not yet published.</p>
      <BackToPodcast />
    </div>
  )
}

/**
 * A published episode's transcript page (`/podcast/:id/transcript`): the "AI" badge and title,
 * date and duration, the /podcast AI subtitle, the player, then the conversation as spoken (opener
 * and sign-off included) with a heading per story, then the story list. Loads client-side like a
 * story page; not prerendered, listed in the server sitemap.
 */
export default function PodcastTranscriptPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: episode, isLoading, isError } = usePodcastEpisode(id)

  if (isLoading) return <div className="page-section py-16 min-h-[60vh]" aria-busy="true"><p className="text-neutral-500">Loading transcript…</p></div>
  if (isError || !episode) return <NotFound />

  const duration = formatEpisodeDuration(episode.durationSec)
  return (
    <>
      <EpisodeHead episode={episode} />
      <article className="page-section py-16">
        <h1 className="page-title" data-ai-generated="title">
          <AiBadge className="mr-2 align-middle" />{' '}
          {episode.title}
        </h1>
        <p className="text-sm text-neutral-600">
          <time dateTime={episode.publishedAt}>{formatEpisodeDate(episode.publishedAt)}</time>
          {duration && <> · {duration}</>}
        </p>
        <p className="page-intro mt-4">
          <AiBadge decorative className="mr-2 align-middle text-neutral-700" />
          {AI_DISCLOSURE_COPY.podcastSubtitle}
        </p>
        <audio controls preload="none" src={episode.audioUrl} className="mt-6 w-full" aria-label={`Play episode: ${episode.title}`} />

        <section aria-labelledby="transcript-heading" className="mt-10" data-ai-generated="transcript">
          <h2 id="transcript-heading" className="section-heading mb-4">Transcript</h2>
          <div className="space-y-3">
            {episode.transcript.map((segment, i) => <TranscriptSegment key={i} segment={segment} />)}
          </div>
        </section>

        {episode.stories.length > 0 && (
          <section aria-labelledby="transcript-stories-heading" className="mt-10">
            <h2 id="transcript-stories-heading" className="section-heading mb-2">Stories in this episode</h2>
            <EpisodeStoryList stories={episode.stories} />
          </section>
        )}

        <div className="border-t border-neutral-200 pt-6 mt-10">
          <BackToPodcast />
        </div>
      </article>
    </>
  )
}
