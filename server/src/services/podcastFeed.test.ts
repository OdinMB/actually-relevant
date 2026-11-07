import { describe, it, expect, afterEach } from 'vitest'
import Parser from 'rss-parser'
import { buildPodcastFeedXml, formatItunesDuration, getFeed, invalidateFeedCache } from './podcastFeed.js'
import type { PublishedEpisode } from './podcastShow.js'
import { config } from '../config.js'
import { PODCAST_EPISODE_AI_LINE, PODCAST_EPISODE_AI_LINE_EDITED, PODCAST_SHOW_DESCRIPTION, PODCAST_UPLIFTING_SHOW_DESCRIPTION } from '../lib/aiLabelCopy.js'
import { podcastEditionInfo } from './podcastEdition.js'

const UPLIFTING = podcastEditionInfo('uplifting')

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
    edition: 'full' as const,
    humanEdited: false,
    audioUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.mp3',
    audioBytes: 5_812_345,
    durationSec: 372,
    transcriptUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.vtt',
    chaptersUrl: 'https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.chapters.json',
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
    const feed = await parser.parseString(buildPodcastFeedXml([], 'full', NOW))
    expect(feed.title).toBe(config.podcast.showTitle)
    expect(feed.items).toEqual([])
  })

  it('declares the itunes, podcast, atom and content namespaces', () => {
    const xml = buildPodcastFeedXml([], 'full', NOW)
    for (const ns of ['xmlns:itunes=', 'xmlns:podcast=', 'xmlns:atom=', 'xmlns:content=']) expect(xml).toContain(ns)
  })

  it('links the Ko-fi page as podcast:funding and declares the weekly schedule as podcast:updateFrequency, on the channel only', () => {
    const xml = buildPodcastFeedXml([episode()], 'full', NOW)
    const channel = channelOnly(xml)
    expect(config.links.kofi).toBe('https://ko-fi.com/odinmb')
    expect(channel).toContain('<podcast:funding url="https://ko-fi.com/odinmb">Donate $5 toward running the site</podcast:funding>')
    expect(channel).toContain('<podcast:updateFrequency rrule="FREQ=WEEKLY">Weekly</podcast:updateFrequency>')
    for (const item of items(xml)) expect(item).not.toMatch(/podcast:(funding|updateFrequency)/)
  })

  it('marks the channel and every item as AI content and describes the show with the standing AI statement', () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2' })], 'full', NOW)
    const txt = '<podcast:txt purpose="ai-content">true</podcast:txt>'
    expect(channelOnly(xml)).toContain(txt)
    for (const item of items(xml)) expect(item).toContain(txt)
    expect(channelOnly(xml)).toContain(`<description>${PODCAST_SHOW_DESCRIPTION.replace(/'/g, '&apos;')}</description>`)
  })

  it('uses the row id as a non-permalink GUID and the CDN file with its exact byte length as enclosure', async () => {
    const ep = episode()
    const xml = buildPodcastFeedXml([ep], 'full', NOW)
    expect(items(xml)[0]).toContain(`<guid isPermaLink="false">${ep.id}</guid>`)
    const [item] = (await parser.parseString(xml)).items
    expect(item.enclosure).toEqual({ url: ep.audioUrl, length: '5812345', type: 'audio/mpeg' })
    expect(item.pubDate).toBe('Mon, 12 Oct 2026 07:30:00 GMT')
  })

  it('starts every description, plain and HTML, with the AI line chosen by "edited by a person"', async () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2', humanEdited: true })], 'full', NOW)
    const [plain, edited] = (await parser.parseString(xml)).items
    expect(plain.content?.startsWith(PODCAST_EPISODE_AI_LINE)).toBe(true)
    expect(edited.content?.startsWith(PODCAST_EPISODE_AI_LINE_EDITED)).toBe(true)
    expect((edited['content:encoded'] as string).startsWith(`<p>${PODCAST_EPISODE_AI_LINE_EDITED.replace(/'/g, '&apos;')}</p>`)).toBe(true)
  })

  it('escapes titles and URLs, and links our analysis only for stories with a page', async () => {
    const xml = buildPodcastFeedXml([episode()], 'full', NOW)
    const [item] = (await parser.parseString(xml)).items
    expect(item.title).toBe('W42: Clean air & <new> vaccines')
    expect(item.content).toContain(`${config.siteUrl}/stories/air`)
    expect(item.content).toContain('https://news.example/1?a=1&b=2')
    expect((item['content:encoded'] as string).match(/Our AI analysis/g)).toHaveLength(1)
  })

  it("links each item to its episode's transcript page and the channel to the podcast page", () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2' })], 'full', NOW)
    const [first, second] = items(xml)
    expect(first).toContain(`<link>${config.siteUrl}/podcast/3f1c2a9e-0000-4000-8000-000000000001/transcript</link>`)
    expect(second).toContain(`<link>${config.siteUrl}/podcast/e2/transcript</link>`)
    expect(channelOnly(xml)).toContain(`<title>${config.podcast.showTitle}</title><link>${config.siteUrl}/podcast</link>`)
  })

  it('carries the transcript and duration when known, and leaves them out otherwise', () => {
    const [withBoth, without] = items(buildPodcastFeedXml([episode(), episode({ id: 'e2', transcriptUrl: null, durationSec: null })], 'full', NOW))
    expect(withBoth).toContain('<podcast:transcript url="https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.vtt" type="text/vtt" language="en"/>')
    expect(withBoth).toContain('<itunes:duration>00:06:12</itunes:duration>')
    expect(without).not.toContain('podcast:transcript')
    expect(without).not.toContain('itunes:duration')
  })

  it('references the JSON chapters when the episode has them, and leaves them out on an older episode', () => {
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2', chaptersUrl: null })], 'full', NOW)
    const [withChapters, older] = items(xml)
    expect(withChapters).toContain(
      '<podcast:chapters url="https://audio.actuallyrelevant.news/episodes/2026-W42-1a2b3c4d.chapters.json" type="application/json+chapters"/>',
    )
    expect(older).not.toContain('podcast:chapters')
    // The tag lives in the Podcasting 2.0 namespace the feed already declares
    expect(xml).toContain('xmlns:podcast="https://podcastindex.org/namespace/1.0"')
  })

  it('writes the configured artwork as itunes:image on the channel and every item, and as the RSS channel image', async () => {
    config.podcast.artworkUrl = 'https://audio.actuallyrelevant.news/show/a&b.jpg'
    const xml = buildPodcastFeedXml([episode(), episode({ id: 'e2' })], 'full', NOW)
    const tag = '<itunes:image href="https://audio.actuallyrelevant.news/show/a&amp;b.jpg"/>'
    expect(channelOnly(xml)).toContain(tag)
    for (const item of items(xml)) expect(item).toContain(tag)
    expect((await parser.parseString(xml)).image?.url).toBe('https://audio.actuallyrelevant.news/show/a&b.jpg')
  })

  it('nests a subcategory inside its category and escapes category names', () => {
    const original = config.podcast.categories
    config.podcast.categories = [{ name: 'News', subcategory: 'Daily News' }, { name: 'Society & Culture' }]
    try {
      expect(channelOnly(buildPodcastFeedXml([], 'full', NOW))).toContain(
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
    const load = async () => {
      calls++
      return []
    }
    await getFeed('full', load)
    await getFeed('full', load)
    expect(calls).toBe(1)
    invalidateFeedCache()
    await getFeed('full', load)
    expect(calls).toBe(2)
  })

  it('keeps Last-Modified, lastBuildDate and the ETag while a rebuild finds the same content, and moves them when it changes', async () => {
    const a = [episode({ id: 'change-tracking-a' })]
    const first = await getFeed('full', async () => a, t('2026-10-12T08:00:00.400Z'))
    expect(first.lastModified.toISOString()).toBe('2026-10-12T08:00:00.000Z')
    expect(first.identity.toString('utf8')).toContain('<lastBuildDate>Mon, 12 Oct 2026 08:00:00 GMT</lastBuildDate>')

    invalidateFeedCache()
    const same = await getFeed('full', async () => a, t('2026-10-12T09:00:00Z'))
    expect(same.lastModified).toEqual(first.lastModified)
    expect(same.etag).toBe(first.etag)

    invalidateFeedCache()
    const changed = await getFeed('full', async () => [...a, episode({ id: 'change-tracking-b' })], t('2026-10-12T10:00:00Z'))
    expect(changed.lastModified.toISOString()).toBe('2026-10-12T10:00:00.000Z')
    expect(changed.etag).not.toBe(first.etag)
    expect(changed.identity.toString('utf8')).toContain('<lastBuildDate>Mon, 12 Oct 2026 10:00:00 GMT</lastBuildDate>')
  })

  it("keeps each show's document and change date apart, and drops both on invalidation", async () => {
    const loads = { full: 0, uplifting: 0 }
    const load = (edition: 'full' | 'uplifting', eps: PublishedEpisode[]) => async () => {
      loads[edition]++
      return eps
    }
    const full = await getFeed('full', load('full', [episode({ id: 'kept-apart-full' })]), t('2026-10-12T08:00:00Z'))
    const uplifting = await getFeed('uplifting', load('uplifting', []), t('2026-10-13T08:00:00Z'))
    expect(full.identity.toString('utf8')).toContain('kept-apart-full')
    expect(uplifting.identity.toString('utf8')).not.toContain('kept-apart-full')
    expect(uplifting.identity.toString('utf8')).toContain(`<title>${UPLIFTING.showTitle}</title>`)
    // The uplifting build did not move the main show's change date
    invalidateFeedCache()
    const fullAgain = await getFeed('full', load('full', [episode({ id: 'kept-apart-full' })]), t('2026-10-14T08:00:00Z'))
    expect(fullAgain.lastModified).toEqual(full.lastModified)
    expect(loads).toEqual({ full: 2, uplifting: 1 })
    await getFeed('uplifting', load('uplifting', []))
    expect(loads.uplifting).toBe(2)
  })
})

describe("the Actually Uplifting show's feed", () => {
  const ARTWORK = 'https://audio.actuallyrelevant.news/show/uplifting-artwork-2026-12.jpg'
  afterEach(() => {
    config.podcast.uplifting.artworkUrl = ''
  })

  it('has its own title, links, channel GUID, artwork and standing AI description', async () => {
    config.podcast.uplifting.artworkUrl = ARTWORK
    const xml = buildPodcastFeedXml([], 'uplifting', NOW)
    const channel = channelOnly(xml)
    const parsed = await parser.parseString(xml)
    expect(parsed.title).toBe(UPLIFTING.showTitle)
    expect(channel).toContain(`<link>${config.siteUrl}${UPLIFTING.pagePath}</link>`)
    expect(channel).toContain(`<atom:link href="${config.siteUrl}${UPLIFTING.feedPath}" rel="self"`)
    expect(channel).toContain(`<podcast:guid>${UPLIFTING.feedGuid}</podcast:guid>`)
    expect(channel).not.toContain(config.podcast.feedGuid)
    expect(channel).toContain(`<itunes:image href="${ARTWORK}"/>`)
    expect(channel).toContain(`<description>${PODCAST_UPLIFTING_SHOW_DESCRIPTION.replace(/'/g, '&apos;')}</description>`)
    expect(channel).toContain('<podcast:txt purpose="ai-content">true</podcast:txt>')
  })

  it("ends each episode's description with the pointer to more uplifting news, before the donation ask", async () => {
    const xml = buildPodcastFeedXml([episode({ edition: 'uplifting' })], 'uplifting', NOW)
    const [item] = (await parser.parseString(xml)).items
    const html = item['content:encoded'] as string
    expect(html.indexOf(UPLIFTING.moreLink!.url)).toBeGreaterThan(html.indexOf('</ol>'))
    expect(html.indexOf(UPLIFTING.moreLink!.url)).toBeLessThan(html.indexOf(config.links.kofi))
    expect(item.content).toContain(UPLIFTING.moreLink!.url)
  })

  it("never changes the main show's document", () => {
    const xml = buildPodcastFeedXml([episode()], 'full', NOW)
    expect(xml).not.toContain(UPLIFTING.feedGuid)
    expect(xml).not.toContain(UPLIFTING.moreLink!.url)
    expect(xml).not.toContain(UPLIFTING.showTitle)
  })
})

describe('formatItunesDuration', () => {
  it('formats seconds as HH:MM:SS', () => {
    expect(formatItunesDuration(372)).toBe('00:06:12')
    expect(formatItunesDuration(3725)).toBe('01:02:05')
  })
})
