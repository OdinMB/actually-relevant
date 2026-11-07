/**
 * How each show and its published episodes are presented to the public: the show's identity (title,
 * standing AI description, feed URL and GUID, artwork, listen links) and each episode's description,
 * which starts with its AI line (`humanEdited` picks the wording). The feed and the public JSON both
 * read it, so the two never disagree.
 */
import type { PodcastEdition, PodcastKind } from '@prisma/client'
import { config } from '../config.js'
import { escapeXml } from '../lib/xml.js'
import { AI_GENERATED_PODCAST_DETAIL_FIELDS, AI_GENERATED_PODCAST_FIELDS, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '../lib/aiProvenance.js'
import { podcastEpisodeAiLine } from '../lib/aiLabelCopy.js'
import { podcastEditionInfo } from './podcastEdition.js'
import { buildShowNotes, type EpisodeStory } from './podcastScript.js'
import { publicTranscript } from './podcastTranscript.js'

/** A published episode as the feed and the public JSON read it. */
export interface PublishedEpisode {
  id: string
  title: string
  /** Picks the AI line's wording (weekly or standalone). */
  kind: PodcastKind
  /** The show it belongs to. */
  edition: PodcastEdition
  summary: string
  stories: EpisodeStory[]
  humanEdited: boolean
  audioUrl: string
  audioBytes: number
  durationSec: number | null
  transcriptUrl: string | null
  /** The Podcasting 2.0 JSON chapters file; null on episodes made before chapters existed. Feed only, not in the public JSON. */
  chaptersUrl: string | null
  publishedAt: Date
}

export interface ListenLink {
  name: string
  url: string
}

/** An Apple Podcasts category, with at most one subcategory, by Apple's exact names. */
export interface PodcastCategory {
  name: string
  subcategory?: string
}

export interface PodcastShowInfo {
  title: string
  description: string
  author: string
  ownerEmail: string
  categories: PodcastCategory[]
  /** The show page on the website. */
  link: string
  /** The public feed URL (a Render rewrite to the API's feed route). */
  feedUrl: string
  /** The channel's `podcast:guid`, fixed for good. */
  feedGuid: string
  /** Square show artwork on the CDN (itunes:image). */
  artworkUrl: string
  listenLinks: ListenLink[]
}

/** The show's public identity; the author, owner and categories are the same for both shows. */
export function podcastShowInfo(edition: PodcastEdition): PodcastShowInfo {
  const p = config.podcast
  const show = podcastEditionInfo(edition)
  return {
    title: show.showTitle,
    description: show.description,
    author: p.showAuthor,
    ownerEmail: p.ownerEmail,
    categories: p.categories,
    link: `${config.siteUrl}${show.pagePath}`,
    feedUrl: `${config.siteUrl}${show.feedPath}`,
    feedGuid: show.feedGuid,
    artworkUrl: show.artworkUrl,
    listenLinks: show.listenLinks,
  }
}

/** The episode's plain-text description: the AI line, the summary, then each story with our analysis and its source. */
export function episodeDescriptionText(episode: PublishedEpisode): string {
  return buildShowNotes(episode.summary, episode.stories, episode.humanEdited, episode.kind, episode.edition)
}

/** The same description as HTML (feed `content:encoded`), every value escaped. */
export function episodeDescriptionHtml(episode: PublishedEpisode): string {
  const link = (href: string, text: string) => `<a href="${escapeXml(href)}">${escapeXml(text)}</a>`
  const items = episode.stories.map(s => {
    const analysis = s.slug ? ` ${link(`${config.siteUrl}/stories/${s.slug}`, 'Our AI analysis')} ·` : ''
    return `<li>${escapeXml(s.title)} (${escapeXml(s.publisher)}).${analysis} ${link(s.sourceUrl, 'Source')}</li>`
  })
  const { moreLink } = podcastEditionInfo(episode.edition)
  return [
    `<p>${escapeXml(podcastEpisodeAiLine(episode.humanEdited, episode.kind))}</p>`,
    `<p>${escapeXml(episode.summary.trim())}</p>`,
    '<p>Stories in this episode:</p>',
    `<ol>${items.join('')}</ol>`,
    ...(moreLink ? [`<p>${escapeXml(moreLink.text)}: ${link(moreLink.url, moreLink.url)}</p>`] : []),
    `<p>${escapeXml(config.donation.pitch)} ${link(config.links.kofi, config.donation.cta)}</p>`,
  ].join('')
}

/** A published episode in the public JSON, with its show, its AI line and a machine-readable AI marker. */
export function toPublicEpisode(episode: PublishedEpisode) {
  return {
    id: episode.id,
    title: episode.title,
    edition: episode.edition,
    aiLine: podcastEpisodeAiLine(episode.humanEdited, episode.kind),
    summary: episode.summary,
    publishedAt: episode.publishedAt.toISOString(),
    durationSec: episode.durationSec,
    audioUrl: episode.audioUrl,
    audioBytes: episode.audioBytes,
    transcriptUrl: episode.transcriptUrl,
    stories: episode.stories.map(s => ({ title: s.title, publisher: s.publisher, sourceUrl: s.sourceUrl, slug: s.slug })),
    aiGenerated: { fields: [...AI_GENERATED_PODCAST_FIELDS], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
  }
}

export type PublicPodcastEpisode = ReturnType<typeof toPublicEpisode>

/** One published episode for its transcript page: the public episode, its readable transcript, and a marker naming it. */
export function toPublicEpisodeDetail(episode: PublishedEpisode & { dialogue: unknown }) {
  return {
    ...toPublicEpisode(episode),
    transcript: publicTranscript(episode.dialogue, episode.kind, episode.stories),
    aiGenerated: { fields: [...AI_GENERATED_PODCAST_DETAIL_FIELDS], digitalSourceType: IPTC_TRAINED_ALGORITHMIC_MEDIA },
  }
}
