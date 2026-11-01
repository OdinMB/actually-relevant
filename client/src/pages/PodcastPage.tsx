import { Helmet } from 'react-helmet-async'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import StructuredData from '../components/StructuredData'
import PodcastSubtitle from '../components/podcast/PodcastSubtitle'
import PodcastEpisode from '../components/podcast/PodcastEpisode'
import PodcastListenOptions from '../components/podcast/PodcastListenOptions'
import { NewsletterCrossLink } from '../components/CrossLinks'
import LoadFailure from '../components/LoadFailure'
import { usePodcastEpisodes } from '../hooks/usePodcastEpisodes'
import { useScrollToHash } from '../hooks/useScrollToHash'
import { loadStateOf } from '../lib/loadState'

/** The public feed URL: a Render rewrite to the API's feed route (.context/seo.md). Static, so it prerenders. */
export const PODCAST_FEED_URL = `${SEO.siteUrl}/podcast.xml`

const META = {
  title: 'Podcast - Actually Relevant',
  description:
    'A weekly five-minute briefing on the news that matters most to humanity, written and voiced by AI. Listen here or subscribe to the RSS feed in your podcast app.',
  url: `${SEO.siteUrl}/podcast`,
}

const breadcrumb = buildBreadcrumbSchema([
  { name: 'Home', url: SEO.siteUrl },
  { name: 'Podcast', url: META.url },
])

function SubscribeOptions() {
  const { data } = usePodcastEpisodes()
  return <PodcastListenOptions listenLinks={data?.show.listenLinks} feedUrl={PODCAST_FEED_URL} />
}

function EpisodeList() {
  const episodesQuery = usePodcastEpisodes()
  const { data } = episodesQuery
  const loadState = loadStateOf(episodesQuery)
  if (loadState === 'loading') return <p className="text-neutral-500 min-h-[6rem]">Loading episodes…</p>
  if (loadState !== 'ready' || !data) return <LoadFailure title="The episodes couldn't load" headingLevel={3} query={episodesQuery} className="py-8" />
  if (data.episodes.length === 0) return <p className="text-neutral-600">The first episode is on its way.</p>
  return (
    <div className="space-y-8">
      {data.episodes.map(e => (
        <PodcastEpisode key={e.id} episode={e} />
      ))}
    </div>
  )
}

/**
 * The public podcast page. The heading, AI subtitle, Apple badge, copy button and feed address
 * are static, so they prerender; the other listen links and the episodes load client-side (the
 * prerenderer does not wait for data). Audio streams from the CDN (`preload="none"`), never
 * through our servers. A link to `PODCAST_SUBSCRIBE_PATH` lands on the Subscribe section.
 */
export default function PodcastPage() {
  useScrollToHash()
  return (
    <>
      <Helmet>
        <title>{META.title}</title>
        <meta name="description" content={META.description} />
        <link rel="canonical" href={META.url} />
        <link rel="alternate" type="application/rss+xml" title="Actually Relevant podcast" href={PODCAST_FEED_URL} />
        <meta property="og:title" content={META.title} />
        <meta property="og:description" content={META.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={META.url} />
        {CommonOgTags({})}
      </Helmet>
      <StructuredData data={breadcrumb} />

      <div className="page-section py-16">
        <h1 className="page-title">Podcast</h1>
        <PodcastSubtitle />

        <section aria-labelledby="podcast-subscribe-heading" className="mt-10">
          <h2 id="podcast-subscribe-heading" className="section-heading">
            Subscribe
          </h2>
          <SubscribeOptions />
        </section>

        <section aria-labelledby="podcast-episodes-heading" className="mt-10">
          <h2 id="podcast-episodes-heading" className="section-heading mb-6">
            Episodes
          </h2>
          <EpisodeList />
        </section>

        <NewsletterCrossLink className="mt-10 border-t border-neutral-200 pt-6" />
      </div>
    </>
  )
}
