import { Helmet } from 'react-helmet-async'
import type { PodcastEdition } from '@shared/types'
import { SEO, CommonOgTags } from '../lib/seo'
import { buildBreadcrumbSchema } from '../lib/structured-data'
import StructuredData from '../components/StructuredData'
import PodcastSubtitle from '../components/podcast/PodcastSubtitle'
import PodcastEpisode from '../components/podcast/PodcastEpisode'
import PodcastListenOptions from '../components/podcast/PodcastListenOptions'
import { NewsletterCrossLink, PodcastShowCrossLink } from '../components/CrossLinks'
import LoadFailure from '../components/LoadFailure'
import NotFoundPage from './NotFoundPage'
import { usePodcastEpisodes } from '../hooks/usePodcastEpisodes'
import { useScrollToHash } from '../hooks/useScrollToHash'
import { loadStateOf } from '../lib/loadState'
import { sectionOgImage } from '../lib/api'
import { PODCAST_SHOWS } from '../lib/podcast'

/** The public feed URL: a Render rewrite to the API's feed route (.context/seo.md). Static, so it prerenders. */
export const PODCAST_FEED_URL = `${SEO.siteUrl}${PODCAST_SHOWS.full.feedPath}`

/** What each show's page says about it; the AI subtitle under the heading is the same for both. */
const SHOW_PAGES: Record<PodcastEdition, { heading: string; title: string; description: string; url: string; feedUrl: string; feedTitle: string }> = {
  full: {
    heading: 'Podcast',
    title: 'Podcast - Actually Relevant',
    description:
      'A weekly five-minute briefing on the news that matters most to humanity, written and voiced by AI. Listen here or subscribe to the RSS feed in your podcast app.',
    url: `${SEO.siteUrl}${PODCAST_SHOWS.full.path}`,
    feedUrl: PODCAST_FEED_URL,
    feedTitle: 'Actually Relevant podcast',
  },
  uplifting: {
    heading: 'Actually Uplifting',
    title: 'Actually Uplifting podcast - Actually Relevant',
    description:
      "A weekly five-minute briefing on the week's uplifting news that matters to humanity, written and voiced by AI. Listen here or subscribe to the RSS feed in your podcast app.",
    url: `${SEO.siteUrl}${PODCAST_SHOWS.uplifting.path}`,
    feedUrl: `${SEO.siteUrl}${PODCAST_SHOWS.uplifting.feedPath}`,
    feedTitle: 'Actually Uplifting podcast',
  },
}

function SubscribeOptions({ edition }: { edition: PodcastEdition }) {
  const { data } = usePodcastEpisodes(edition)
  // The badge shown until the data arrives is the main show's listing, so the other show waits for its own
  const listenLinks = edition === 'full' ? data?.show.listenLinks : (data?.show.listenLinks ?? [])
  return <PodcastListenOptions listenLinks={listenLinks} feedUrl={SHOW_PAGES[edition].feedUrl} />
}

function EpisodeList({ edition }: { edition: PodcastEdition }) {
  const episodesQuery = usePodcastEpisodes(edition)
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

/** The line pointing to the other show, once Actually Uplifting is public. */
function OtherShow({ edition }: { edition: PodcastEdition }) {
  const { data } = usePodcastEpisodes(edition)
  return data?.upliftingShowOpen ? <PodcastShowCrossLink edition={edition} className="mt-4 text-center" /> : null
}

function ShowPage({ edition }: { edition: PodcastEdition }) {
  useScrollToHash()
  const page = SHOW_PAGES[edition]
  const breadcrumb = buildBreadcrumbSchema([
    { name: 'Home', url: SEO.siteUrl },
    { name: page.heading, url: page.url },
  ])
  return (
    <>
      <Helmet>
        <title>{page.title}</title>
        <meta name="description" content={page.description} />
        <link rel="canonical" href={page.url} />
        <link rel="alternate" type="application/rss+xml" title={page.feedTitle} href={page.feedUrl} />
        <meta property="og:title" content={page.title} />
        <meta property="og:description" content={page.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={page.url} />
        {CommonOgTags(sectionOgImage('podcast'))}
      </Helmet>
      <StructuredData data={breadcrumb} />

      <div className="page-section py-16">
        <h1 className="page-title">{page.heading}</h1>
        <PodcastSubtitle />
        <OtherShow edition={edition} />

        <section aria-labelledby="podcast-subscribe-heading" className="mt-10">
          <h2 id="podcast-subscribe-heading" className="section-heading">
            Subscribe
          </h2>
          <SubscribeOptions edition={edition} />
        </section>

        <section aria-labelledby="podcast-episodes-heading" className="mt-10">
          <h2 id="podcast-episodes-heading" className="section-heading mb-6">
            Episodes
          </h2>
          <EpisodeList edition={edition} />
        </section>

        <NewsletterCrossLink className="mt-10 border-t border-neutral-200 pt-6" />
      </div>
    </>
  )
}

/**
 * Actually Uplifting's page (`/podcast/uplifting`): never prerendered, so nothing about the show is
 * shown, or put in the head, before the API says it is public; "Page not found" with noindex while
 * it is switched off.
 */
function UpliftingShowPage() {
  const showQuery = usePodcastEpisodes('uplifting')
  // Never prerendered: the not-found view and its noindex always show (lib/loadState.ts)
  const loadState = loadStateOf(showQuery, false)
  if (loadState === 'loading')
    return (
      <div className="page-section py-16 min-h-[60vh]" aria-busy="true">
        <p className="text-neutral-500">Loading…</p>
      </div>
    )
  if (loadState === 'not-found') return <NotFoundPage />
  if (loadState === 'failed') return <LoadFailure title="This page couldn't load" query={showQuery} className="page-section" />
  return <ShowPage edition="uplifting" />
}

/**
 * A podcast show's public page: Actually Relevant at /podcast, Actually Uplifting at
 * /podcast/uplifting. The main show's heading, AI subtitle, Apple badge, copy button and feed
 * address are static, so they prerender; the other listen links and the episodes load client-side
 * (never asked for while prerendering, so no dated episode list is baked in). Audio streams from the
 * CDN (`preload="none"`), never through our servers. A link to `podcastSubscribePath(edition)` lands
 * on the Subscribe section.
 */
export default function PodcastPage({ edition = 'full' }: { edition?: PodcastEdition }) {
  return edition === 'uplifting' ? <UpliftingShowPage /> : <ShowPage edition="full" />
}
