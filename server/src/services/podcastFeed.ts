/**
 * The podcast RSS document and its cache. Hand-built RSS 2.0 with the itunes, podcast (Podcasting
 * 2.0), atom and content namespaces (ADR-0010): the channel and every item carry
 * `<podcast:txt purpose="ai-content">true</podcast:txt>`, every item description starts with the
 * episode's AI line, the GUID is the row id and the enclosure the CDN URL with its exact byte length.
 */
import { createHash } from 'node:crypto'
import { config } from '../config.js'
import { TTLCache, cached } from '../lib/cache.js'
import { prepareRepresentation, type Representation } from '../lib/httpRepresentation.js'
import { escapeXml } from '../lib/xml.js'
import {
  episodeDescriptionHtml, episodeDescriptionText, podcastShowInfo, type PodcastCategory, type PublishedEpisode,
} from './podcastShow.js'

const NAMESPACES = [
  'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"',
  'xmlns:podcast="https://podcastindex.org/namespace/1.0"',
  'xmlns:atom="http://www.w3.org/2005/Atom"',
  'xmlns:content="http://purl.org/rss/1.0/modules/content/"',
].join(' ')

const AI_CONTENT_TXT = '<podcast:txt purpose="ai-content">true</podcast:txt>'

/** `<name>escaped text</name>` */
const el = (name: string, text: string) => `<${name}>${escapeXml(text)}</${name}>`

/** HH:MM:SS, as Apple recommends for itunes:duration. */
export function formatItunesDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function categoryXml({ name, subcategory }: PodcastCategory): string {
  const open = `<itunes:category text="${escapeXml(name)}"`
  return subcategory ? `${open}><itunes:category text="${escapeXml(subcategory)}"/></itunes:category>` : `${open}/>`
}

function itemXml(episode: PublishedEpisode, artworkUrl: string): string {
  const parts = [
    el('title', episode.title),
    el('itunes:title', episode.title),
    el('description', episodeDescriptionText(episode)),
    el('content:encoded', episodeDescriptionHtml(episode)),
    el('link', `${config.siteUrl}/podcast`),
    `<guid isPermaLink="false">${escapeXml(episode.id)}</guid>`,
    el('pubDate', episode.publishedAt.toUTCString()),
    `<enclosure url="${escapeXml(episode.audioUrl)}" length="${episode.audioBytes}" type="audio/mpeg"/>`,
    ...(episode.durationSec != null ? [el('itunes:duration', formatItunesDuration(episode.durationSec))] : []),
    el('itunes:episodeType', 'full'),
    el('itunes:explicit', 'false'),
    `<itunes:image href="${escapeXml(artworkUrl)}"/>`,
    ...(episode.transcriptUrl ? [`<podcast:transcript url="${escapeXml(episode.transcriptUrl)}" type="text/vtt" language="en"/>`] : []),
    AI_CONTENT_TXT,
  ]
  return `<item>${parts.join('')}</item>`
}

/**
 * The feed for the given published episodes (newest first). Pure; an empty list is a valid feed.
 */
export function buildPodcastFeedXml(episodes: PublishedEpisode[], now: Date = new Date()): string {
  const show = podcastShowInfo()
  const channel = [
    el('title', show.title),
    el('link', show.link),
    `<atom:link href="${escapeXml(show.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    el('description', show.description),
    el('itunes:summary', show.description),
    el('language', 'en'),
    el('copyright', `© ${now.getUTCFullYear()} ${show.author}`),
    el('lastBuildDate', now.toUTCString()),
    el('itunes:author', show.author),
    `<itunes:owner>${el('itunes:name', show.author)}${el('itunes:email', show.ownerEmail)}</itunes:owner>`,
    `<itunes:image href="${escapeXml(show.artworkUrl)}"/>`,
    `<image>${el('url', show.artworkUrl)}${el('title', show.title)}${el('link', show.link)}</image>`,
    ...show.categories.map(categoryXml),
    el('itunes:explicit', 'false'),
    el('itunes:type', 'episodic'),
    `<podcast:locked owner="${escapeXml(show.ownerEmail)}">no</podcast:locked>`,
    el('podcast:guid', config.podcast.feedGuid),
    AI_CONTENT_TXT,
    ...episodes.map(episode => itemXml(episode, show.artworkUrl)),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" ${NAMESPACES}><channel>${channel.join('')}</channel></rss>\n`
}

const feedCache = new TTLCache<Representation>(config.feed.cacheMaxAge * 1000)
const cacheSlot = 'podcast-feed'

/** Fixed date for comparing content: the document without its build date. */
const CONTENT_ONLY = new Date(0)

/**
 * When this process last saw the feed's content change. A rebuild that finds the same content keeps
 * the date, so lastBuildDate, Last-Modified and the ETag stay put and apps get their 304. After a
 * restart the date is the first build's: never earlier than a real change (a config change, an
 * unpublish), at the cost of one full refetch per deploy.
 */
let contentState: { hash: string; changedAt: Date } | null = null

function contentChangedAt(episodes: PublishedEpisode[], now: Date): Date {
  const hash = createHash('sha256').update(buildPodcastFeedXml(episodes, CONTENT_ONLY)).digest('hex')
  if (contentState?.hash !== hash) contentState = { hash, changedAt: new Date(Math.floor(now.getTime() / 1000) * 1000) }
  return contentState.changedAt
}

/**
 * The feed, ready to serve (body, gzip and deflate, ETag, Last-Modified), cached in-process for
 * `config.feed.cacheMaxAge`; `load` reads the published episodes. lastBuildDate is the time the
 * content last changed, so it matches Last-Modified.
 */
export function getFeed(load: () => Promise<PublishedEpisode[]>, now: Date = new Date()): Promise<Representation> {
  return cached(feedCache, cacheSlot, async () => {
    const episodes = await load()
    const changedAt = contentChangedAt(episodes, now)
    return prepareRepresentation(buildPodcastFeedXml(episodes, changedAt), changedAt)
  })
}

/** Drop the cached feed, so the next request rebuilds it (after a publish, an unpublish or an AI-line change). */
export function invalidateFeedCache(): void {
  feedCache.invalidate(cacheSlot)
}
