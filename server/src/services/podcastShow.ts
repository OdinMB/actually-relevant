/**
 * How the show and its published episodes are presented to the public: the show's identity (title,
 * standing AI description, feed URL, artwork, listen links) and each episode's description, which
 * starts with its AI line (`humanEdited` picks the wording). The feed and the public JSON both read
 * it, so the two never disagree.
 */
import { config } from '../config.js'
import { escapeXml } from '../lib/xml.js'
import { AI_GENERATED_PODCAST_FIELDS, IPTC_TRAINED_ALGORITHMIC_MEDIA } from '../lib/aiProvenance.js'
import { PODCAST_SHOW_DESCRIPTION, podcastEpisodeAiLine } from '../lib/aiLabelCopy.js'
import { buildShowNotes, type EpisodeStory } from './podcastScript.js'

/** A published episode as the feed and the public JSON read it. */
export interface PublishedEpisode {
  id: string
  title: string
  summary: string
  stories: EpisodeStory[]
  humanEdited: boolean
  audioUrl: string
  audioBytes: number
  durationSec: number | null
  transcriptUrl: string | null
  publishedAt: Date
}

export interface ListenLink {
  name: string
  url: string
}

export interface PodcastShowInfo {
  title: string
  description: string
  author: string
  ownerEmail: string
  category: string
  /** The show page on the website. */
  link: string
  /** The public feed URL (a Render rewrite to the API's feed route). */
  feedUrl: string
  /** Square show artwork on the CDN (itunes:image). */
  artworkUrl: string
  listenLinks: ListenLink[]
}

export function podcastShowInfo(): PodcastShowInfo {
  const p = config.podcast
  return {
    title: p.showTitle,
    description: PODCAST_SHOW_DESCRIPTION,
    author: p.showAuthor,
    ownerEmail: p.ownerEmail,
    category: p.category,
    link: `${config.siteUrl}/podcast`,
    feedUrl: `${config.siteUrl}${p.feedPath}`,
    artworkUrl: p.artworkUrl,
    listenLinks: p.listenLinks,
  }
}

/** The episode's plain-text description: the AI line, the summary, then each story with our analysis and its source. */
export function episodeDescriptionText(episode: PublishedEpisode): string {
  return buildShowNotes(episode.summary, episode.stories, episode.humanEdited)
}

/** The same description as HTML (feed `content:encoded`), every value escaped. */
export function episodeDescriptionHtml(episode: PublishedEpisode): string {
  const link = (href: string, text: string) => `<a href="${escapeXml(href)}">${escapeXml(text)}</a>`
  const items = episode.stories.map(s => {
    const analysis = s.slug ? ` ${link(`${config.siteUrl}/stories/${s.slug}`, 'Our AI analysis')} ·` : ''
    return `<li>${escapeXml(s.title)} (${escapeXml(s.publisher)}).${analysis} ${link(s.sourceUrl, 'Source')}</li>`
  })
  return [
    `<p>${escapeXml(podcastEpisodeAiLine(episode.humanEdited))}</p>`,
    `<p>${escapeXml(episode.summary.trim())}</p>`,
    '<p>Stories in this episode:</p>',
    `<ol>${items.join('')}</ol>`,
  ].join('')
}

/** A published episode in the public JSON, with its AI line and a machine-readable AI marker. */
export function toPublicEpisode(episode: PublishedEpisode) {
  return {
    id: episode.id,
    title: episode.title,
    aiLine: podcastEpisodeAiLine(episode.humanEdited),
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
