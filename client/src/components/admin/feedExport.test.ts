import { describe, it, expect } from 'vitest'
import { feedIssues, makeFeed, makeQuality } from '../../test/feeds'
import { buildFeedExport, feedExportFileName } from './feedExport'

const now = new Date('2026-11-01T09:30:00.000Z')

const healthy = makeFeed({ id: 'feed-1' })
const broken = makeFeed({
  id: 'feed-2',
  title: 'Broken Feed',
  displayTitle: 'Broken',
  rssUrl: 'https://broken.example/rss',
  url: null,
  issueId: 'i-pandemics',
  language: 'de',
  region: 'western_europe',
  contentSource: 'rss',
  crawlIntervalHours: 12,
  htmlSelector: 'article .body',
  paywallDetection: false,
  paywallTitleMarker: '^\\(S\\+\\)',
  lastCrawledAt: '2026-10-30T06:00:00.000Z',
  lastSuccessfulCrawlAt: '2026-10-29T06:00:00.000Z',
  lastCrawlResult: 'RSS fetch failed: HTTP 404',
  lastCrawlError: 'RSS fetch failed: HTTP 404',
  lastCrawlErrorAt: '2026-11-01T06:00:00.000Z',
  consecutiveFailedCrawls: 2,
  consecutiveEmptyCrawls: 2,
})
const inactive = makeFeed({ id: 'feed-3', active: false, lastCrawlResult: 'RSS fetch failed: HTTP 410' })

const quality = {
  'feed-1': makeQuality(),
  'feed-2': makeQuality({ totalCrawled: 30, publishedCount: 3, publishRate: 0.1, avgRelevance: 4.4, extractionMethods: { jina: 2, readability: 9 } }),
}

const input = { feeds: [healthy, broken, inactive], issues: feedIssues, quality, now }

describe('buildFeedExport', () => {
  it('holds only the feeds with problems for that scope, and every feed, inactive ones included, for all', () => {
    expect(buildFeedExport(input, 'problems').feeds.map(feed => feed.id)).toEqual(['feed-2'])
    expect(buildFeedExport(input, 'all').feeds.map(feed => feed.id)).toEqual(['feed-1', 'feed-2', 'feed-3'])
  })

  it('exports each feed with its issue and parent issue, settings, crawl state, quality summary and problems', () => {
    const data = buildFeedExport(input, 'problems')

    expect(data).toMatchObject({ scope: 'problems', exportedAt: '2026-11-01T09:30:00.000Z' })
    expect(data.feeds[0]).toEqual({
      id: 'feed-2',
      title: 'Broken Feed',
      displayTitle: 'Broken',
      rssUrl: 'https://broken.example/rss',
      url: null,
      issue: 'pandemics',
      issueName: 'Pandemics',
      parentIssueName: 'Health',
      language: 'de',
      region: 'western_europe',
      active: true,
      contentSource: 'rss',
      crawlIntervalHours: 12,
      htmlSelector: 'article .body',
      paywallDetection: false,
      paywallTitleMarker: '^\\(S\\+\\)',
      createdAt: '2026-01-15T00:00:00.000Z',
      lastCrawledAt: '2026-10-30T06:00:00.000Z',
      lastSuccessfulCrawlAt: '2026-10-29T06:00:00.000Z',
      lastCrawlResult: 'RSS fetch failed: HTTP 404',
      lastCrawlError: 'RSS fetch failed: HTTP 404',
      lastCrawlErrorAt: '2026-11-01T06:00:00.000Z',
      consecutiveFailedCrawls: 2,
      consecutiveEmptyCrawls: 2,
      quality: { crawled: 30, published: 3, publishRate: 0.1, avgRelevance: 4.4, dominantMethod: 'readability' },
      problems: ['rss-fetch-failed'],
    })
  })

  it('exports a top-level issue without a parent, and null for an issue or metrics it does not have', () => {
    const orphan = makeFeed({ id: 'feed-4', issueId: 'i-gone' })
    const [planet, unknown] = buildFeedExport({ ...input, feeds: [healthy, orphan] }, 'all').feeds

    expect(planet).toMatchObject({ issue: 'planet-climate', issueName: 'Planet & Climate', parentIssueName: null })
    expect(unknown).toMatchObject({ issue: null, issueName: null, parentIssueName: null, quality: null })
  })

  it('exports the issue tree, each sub-issue under its parent', () => {
    expect(buildFeedExport(input, 'all').issues).toEqual([
      { slug: 'health', name: 'Health', children: [{ slug: 'pandemics', name: 'Pandemics' }] },
      { slug: 'planet-climate', name: 'Planet & Climate', children: [] },
    ])
  })
})

describe('feedExportFileName', () => {
  it('names the file after the scope and the local date', () => {
    expect(feedExportFileName('problems', new Date(2026, 10, 1, 23, 30))).toBe('feeds-problems-2026-11-01.json')
    expect(feedExportFileName('all', new Date(2026, 0, 5, 0, 10))).toBe('feeds-all-2026-01-05.json')
  })
})
