import { Helmet } from 'react-helmet-async'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import StructuredData from '../components/StructuredData'
import AiBadge from '../components/ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import PodcastEpisode from '../components/podcast/PodcastEpisode'
import { usePodcastEpisodes } from '../hooks/usePodcastEpisodes'

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

const LINK_CLASS = 'text-brand-700 underline hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500 rounded'

function EpisodeList() {
  const { data, isLoading, isError } = usePodcastEpisodes()
  if (isLoading) return <p className="text-neutral-500 min-h-[6rem]">Loading episodes…</p>
  if (isError || !data) return <p className="text-neutral-600">The episodes could not be loaded. Please try again later.</p>
  return (
    <>
      {data.show.listenLinks.length > 0 && (
        <ul aria-label="Listen in your podcast app" className="mb-8 flex flex-wrap gap-x-4 gap-y-2">
          {data.show.listenLinks.map(link => (
            <li key={link.url}><a href={link.url} className={LINK_CLASS} rel="noopener noreferrer" target="_blank">{link.name}</a></li>
          ))}
        </ul>
      )}
      {data.episodes.length === 0
        ? <p className="text-neutral-600">The first episode is on its way.</p>
        : <div className="space-y-8">{data.episodes.map(e => <PodcastEpisode key={e.id} episode={e} />)}</div>}
    </>
  )
}

/**
 * The public podcast page. The heading, AI subtitle and feed link are static, so they
 * prerender; the listen links and the episodes load client-side (the prerenderer does not wait
 * for data). Audio streams from the CDN (`preload="none"`), never through our servers.
 */
export default function PodcastPage() {
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
        <p className="page-intro">
          <AiBadge decorative className="mr-2 align-middle text-neutral-700" />
          {AI_DISCLOSURE_COPY.podcastSubtitle}
        </p>

        <section aria-labelledby="podcast-subscribe-heading" className="mt-10 prose">
          <h2 id="podcast-subscribe-heading" className="section-heading">Subscribe</h2>
          <p>
            Add the feed to any podcast app that accepts an RSS address:{' '}
            <a href={PODCAST_FEED_URL} className={LINK_CLASS}>{PODCAST_FEED_URL}</a>
          </p>
        </section>

        <section aria-labelledby="podcast-episodes-heading" className="mt-10">
          <h2 id="podcast-episodes-heading" className="section-heading mb-6">Episodes</h2>
          <EpisodeList />
        </section>
      </div>
    </>
  )
}
