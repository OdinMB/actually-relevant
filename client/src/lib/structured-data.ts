import type { PublicPodcastEpisode, PublicStory } from '@shared/types'
import type { PublicIssue } from './api'
import { podcastTranscriptPath } from './podcast'
import { SEO } from './seo'

const LOGO_URL = `${SEO.siteUrl}/images/logo.png`

// `<`, `>`, `&` and the two JS line terminators U+2028 / U+2029 (built from
// char codes so the source file stays plain ASCII).
const JSON_LD_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, 'g')

/**
 * Serializes a schema for a `<script type="application/ld+json">` element.
 * Titles and summaries come from crawled text, so plain `JSON.stringify` could
 * carry a `</script>` that closes the element early in prerendered HTML. Each
 * unsafe character becomes a JSON `\uXXXX` escape, so the parsed value is unchanged.
 * Every JSON-LD script goes through this, whether via `StructuredData` or Helmet.
 */
export function toJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    JSON_LD_UNSAFE,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

const publisher = {
  '@type': 'Organization',
  name: SEO.siteName,
  url: SEO.siteUrl,
  logo: {
    '@type': 'ImageObject',
    url: LOGO_URL,
  },
}

export function buildArticleSchema(story: PublicStory) {
  const displayTitle =
    story.titleLabel && story.title
      ? `${story.titleLabel}: ${story.title}`
      : story.title || ''
  const issueName = story.issue?.name ?? story.feed?.issue?.name ?? 'News'

  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: displayTitle.slice(0, 110),
    description: (story.summary || displayTitle).slice(0, 200),
    datePublished: story.datePublished || story.dateCrawled,
    author: {
      '@type': 'Organization',
      name: SEO.siteName,
      url: SEO.siteUrl,
    },
    publisher,
    // The page that explains that AI writes and selects the story text
    publishingPrinciples: `${SEO.siteUrl}/methodology`,
    mainEntityOfPage: `${SEO.siteUrl}/stories/${story.slug}`,
    image: SEO.ogImage,
    articleSection: issueName,
  }
}

export function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SEO.siteName,
    url: SEO.siteUrl,
    description: SEO.defaultDescription,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SEO.siteUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SEO.siteName,
    url: SEO.siteUrl,
    logo: LOGO_URL,
    sameAs: [],
  }
}

export function buildCollectionPageSchema(issue: PublicIssue) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${issue.name} - ${SEO.siteName}`,
    description: (issue.intro || issue.description).slice(0, 200),
    url: `${SEO.siteUrl}/issues/${issue.slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: SEO.siteName,
    },
  }
}

/** A published podcast episode, described on its transcript page. */
export function buildPodcastEpisodeSchema(
  episode: Pick<PublicPodcastEpisode, 'id' | 'title' | 'summary' | 'publishedAt' | 'durationSec' | 'audioUrl'>,
) {
  const sec = episode.durationSec
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episode.title,
    description: episode.summary.slice(0, 200),
    datePublished: episode.publishedAt,
    url: `${SEO.siteUrl}${podcastTranscriptPath(episode.id)}`,
    ...(sec != null ? { timeRequired: `PT${Math.floor(sec / 60)}M${sec % 60}S` } : {}),
    associatedMedia: { '@type': 'MediaObject', contentUrl: episode.audioUrl, encodingFormat: 'audio/mpeg' },
    partOfSeries: {
      '@type': 'PodcastSeries',
      name: SEO.siteName,
      url: `${SEO.siteUrl}/podcast`,
      webFeed: `${SEO.siteUrl}/podcast.xml`,
    },
    publisher,
    // The page that explains that AI writes the episodes
    publishingPrinciples: `${SEO.siteUrl}/methodology`,
  }
}

export function buildBreadcrumbSchema(items: { name: string; url?: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  }
}
