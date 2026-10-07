import { describe, it, expect, afterEach } from 'vitest'
import Parser from 'rss-parser'
import { buildPodcastFeedXml, formatItunesDuration, getFeed, invalidateFeedCache } from './podcastFeed.js'
import type { PublishedEpisode } from './podcastShow.js'
import { config } from '../config.js'
import { PODCAST_EPISODE_AI_LINE, PODCAST_EPISODE_AI_LINE_EDITED, PODCAST_SHOW_DESCRIPTION } from '../lib/aiLabelCopy.js'

const NOW = new Date('2026-10-12T08:00:00Z')

function episode(overrides: Partial<PublishedEpisode> = {}): PublishedEpisode {
  return {
    id: '3f1c2a9e-0000-4000-8000-000000000001',
    title: 'W42: Clean air & <new> vaccines',
    summary: 'Two stories that matter.',
    stories: [
      { ref: 1, id: 's1', title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://news.example/1?a=1&b=2', slug: 'air', issue: 'Planet' },
      { ref: 2, id: 's2', title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://news.example/2', slug: null, issue: 'Health' },
    ],
    kind: 'weekly' as const,
    humanEdited: false,
    audioUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3',
    audioBytes: 5_812_345,
    durationSec: 372,
    transcriptUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.vtt',
    publishedAt: new Date('2026-10-12T07:30:00Z'),
    ...overrides,
  }
}

const parser = new Parser({ customFields: { item: ['content:encoded'] } })

/** The raw XML of each <item>. */
const items = (xml: string) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1])
const channelOnly = (xml: string) => xml.replace(/<item>[\s\S]*?<\/item>/g, '')

const originalArtwork = config.podcast.artworkUrl
afterEach(() => {
  config.podcast.artworkUrl = originalArtwork
  invalidateFeedCache()
})

describe('buildPodcastFeedXml', () => {
  it('is well-formed RSS with an empty episode list (before the first publish)', async () => {
    const feed = await parser.parseString(buildPodcastFeedXml([], NOW))
    expect(feed.title).toBe(config.podcast.showTitle)
    expect(feed.items).toEqual([])
  })

  it('declares the itunes, podcast, atom and content namespaces', () => {
    const xml = buildPodcastFeedXml([], NOW)
    for (const ns of ['xmlns:itunes=', 'xmlns:podcast=', 'xmlns:atom=', 'xmlns:content=']) expect(xml).toContain(ns)
  })

  it('marks the channel and every item as AI content and describes the show with the standing AI statement', () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2' })], NOW)
    const txt = '<podcast:txt purpose="ai-content">true</podcast:txt>'
    expect(channelOnly(xml)).toContain(txt)
    for (const item of items(xml)) expect(item).toContain(txt)
    expect(channelOnly(xml)).toContain(`<description>${PODCAST_SHOW_DESCRIPTION.replace(/'/g, '&apos;')}</description>`)
  })

  it('uses the row id as a non-permalink GUID and the CDN file with its exact byte length as enclosure', async () => {
    const ep = episode()
    const xml = buildPodcastFeedXml([ep], NOW)
    expect(items(xml)[0]).toContain(`<guid isPermaLink="false">${ep.id}</guid>`)
    const [item] = (await parser.parseString(xml)).items
    expect(item.enclosure).toEqual({ url: ep.audioUrl, length: '5812345', type: 'audio/mpeg' })
    expect(item.pubDate).toBe('Mon, 12 Oct 2026 07:30:00 GMT')
  })

  it('starts every description, plain and HTML, with the AI line chosen by "edited by a person"', async () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2', humanEdited: true })], NOW)
    const [plain, edited] = (await parser.parseString(xml)).items
    expect(plain.content?.startsWith(PODCAST_EPISODE_AI_LINE)).toBe(true)
    expect(edited.content?.startsWith(PODCAST_EPISODE_AI_LINE_EDITED)).toBe(true)
    expect((edited['content:encoded'] as string).startsWith(`<p>${PODCAST_EPISODE_AI_LINE_EDITED.replace(/'/g, '&apos;')}</p>`)).toBe(true)
  })

  it('escapes titles and URLs, and links our analysis only for stories with a page', async () => {
    const xml = buildPodcastFeedXml([episode()], NOW)
    const [item] = (await parser.parseString(xml)).items
    expect(item.title).toBe('W42: Clean air & <new> vaccines')
    expect(item.content).toContain(`${config.siteUrl}/stories/air`)
    expect(item.content).toContain('https://news.example/1?a=1&b=2')
    expect((item['content:encoded'] as string).match(/Our AI analysis/g)).toHaveLength(1)
  })

  it('carries the transcript and duration when known, and leaves them out otherwise', () => {
    const [withBoth, without] = items(buildPodcastFeedXml([episode(), episode({ id: 'e2', transcriptUrl: null, durationSec: null })], NOW))
    expect(withBoth).toContain('<podcast:transcript url="https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.vtt" type="text/vtt" language="en"/>')
    expect(withBoth).toContain('<itunes:duration>00:06:12</itunes:duration>')
    expect(without).not.toContain('podcast:transcript')
    expect(without).not.toContain('itunes:duration')
  })

  it('writes the configured artwork as itunes:image on the channel and every item, and as the RSS channel image', async () => {
    config.podcast.artworkUrl = 'https://audio.actuallyrelevant.news/show/a&b.jpg'
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2' })], NOW)
    const tag = '<itunes:image href="https://audio.actuallyrelevant.news/show/a&amp;b.jpg"/>'
    expect(channelOnly(xml)).toContain(tag)
    for (const item of items(xml)) expect(item).toContain(tag)
    expect((await parser.parseString(xml)).image?.url).toBe('https://audio.actuallyrelevant.news/show/a&b.jpg')
  })

  it('nests a subcategory inside its category and escapes category names', () => {
    const original = config.podcast.categories
    config.podcast.categories = [{ name: 'News', subcategory: 'Daily News' }, { name: 'Society & Culture' }]
    try {
      expect(channelOnly(buildPodcastFeedXml([], NOW))).toContain(
        '<itunes:category text="News"><itunes:category text="Daily News"/></itunes:category><itunes:category text="Society &amp; Culture"/>',
      )
    } finally {
      config.podcast.categories = original
    }
  })
})

describe('getFeed', () => {
  const t = (iso: string) => new Date(iso)

  it('caches the document until it is invalidated', async () => {
    let calls = 0
    const load = async () => { calls++; return [] }
    await getFeed(load)
    await getFeed(load)
    expect(calls).toBe(1)
    invalidateFeedCache()
    await getFeed(load)
    expect(calls).toBe(2)
  })

  it('keeps Last-Modified, lastBuildDate and the ETag while a rebuild finds the same content, and moves them when it changes', async () => {
    const a = [episode({ id: 'change-tracking-a' })]
    const first = await getFeed(async () => a, t('2026-10-12T08:00:00.400Z'))
    expect(first.lastModified.toISOString()).toBe('2026-10-12T08:00:00.000Z')
    expect(first.identity.toString('utf8')).toContain('<lastBuildDate>Mon, 12 Oct 2026 08:00:00 GMT</lastBuildDate>')

    invalidateFeedCache()
    const same = await getFeed(async () => a, t('2026-10-12T09:00:00Z'))
    expect(same.lastModified).toEqual(first.lastModified)
    expect(same.etag).toBe(first.etag)

    invalidateFeedCache()
    const changed = await getFeed(async () => [...a, episode({ id: 'change-tracking-b' })], t('2026-10-12T10:00:00Z'))
    expect(changed.lastModified.toISOString()).toBe('2026-10-12T10:00:00.000Z')
    expect(changed.etag).not.toBe(first.etag)
    expect(changed.identity.toString('utf8')).toContain('<lastBuildDate>Mon, 12 Oct 2026 10:00:00 GMT</lastBuildDate>')
  })
})

describe('formatItunesDuration', () => {
  it('formats seconds as HH:MM:SS', () => {
    expect(formatItunesDuration(372)).toBe('00:06:12')
    expect(formatItunesDuration(3725)).toBe('01:02:05')
  })
})
