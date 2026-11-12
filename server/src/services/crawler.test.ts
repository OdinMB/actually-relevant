import { describe, it, expect, vi, beforeEach } from 'vitest'
import { config } from '../config.js'
import { BadRequestError, UnprocessableError } from '../utils/errors.js'

const mockParseFeed = vi.hoisted(() => vi.fn())
const mockExtractContent = vi.hoisted(() => vi.fn())
const mockCheckOptOut = vi.hoisted(() => vi.fn())
const mockGetExistingUrls = vi.hoisted(() => vi.fn())
const mockCreateStory = vi.hoisted(() => vi.fn())
const mockGetFeedById = vi.hoisted(() => vi.fn())
const mockGetDueFeeds = vi.hoisted(() => vi.fn())
const mockUpdateCrawlStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpdateFeedCacheHeaders = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('./rssParser.js', () => ({ parseFeed: mockParseFeed }))
vi.mock('./extractor.js', async importOriginal => ({ ...(await importOriginal<typeof import('./extractor.js')>()), extractContent: mockExtractContent }))
vi.mock('./publisherOptOut.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./publisherOptOut.js')>()),
  checkOptOut: mockCheckOptOut,
}))
vi.mock('./story.js', () => ({
  getExistingUrls: mockGetExistingUrls,
  createStory: mockCreateStory,
}))
vi.mock('./feed.js', () => ({
  getFeedById: mockGetFeedById,
  getDueFeeds: mockGetDueFeeds,
  updateCrawlStatus: mockUpdateCrawlStatus,
  updateFeedCacheHeaders: mockUpdateFeedCacheHeaders,
}))

const { crawlFeed, crawlAllDueFeeds, crawlUrl } = await import('./crawler.js')

const sampleFeed = {
  id: 'feed-1',
  title: 'Test Feed',
  rssUrl: 'https://example.com/feed',
  htmlSelector: null,
  paywallDetection: true,
  paywallTitleMarker: null,
  contentSource: 'page',
  lastEtag: null,
  lastModified: null,
}

function rssResult(items: any[], opts?: { notModified?: boolean; etag?: string; lastModified?: string }) {
  return {
    items,
    notModified: opts?.notModified ?? false,
    cacheHeaders: {
      etag: opts?.etag ?? null,
      lastModified: opts?.lastModified ?? null,
    },
  }
}

const NOT_RESERVED = { reserved: false }
const ROBOTS_RESERVED = { reserved: true, reason: 'robots.txt disallows ActuallyRelevant', unverified: false }

beforeEach(() => {
  mockCheckOptOut.mockReset()
  mockCheckOptOut.mockResolvedValue(NOT_RESERVED)
})

describe('crawlFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when feed not found', async () => {
    mockGetFeedById.mockResolvedValue(null)
    await expect(crawlFeed('nonexistent')).rejects.toThrow('Feed not found')
  })

  it('returns early with zero counts when RSS returns no items', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([]))

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: true,
        newItemCount: 0,
        rssItemCount: 0,
      }),
    )
  })

  it('records an RSS fetch or parse failure as a crawl error, not an empty feed', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(0)
    expect(result.errors).toBe(1)
    expect(result.errorMessage).toContain('RSS fetch failed')
    expect(result.errorMessage).toContain('ECONNREFUSED')
    expect(mockUpdateCrawlStatus).toHaveBeenCalledTimes(1)
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: false,
        fetchFailed: true,
        rssItemCount: 0,
        errorMessage: expect.stringContaining('ECONNREFUSED'),
      }),
    )
    expect(mockUpdateFeedCacheHeaders).not.toHaveBeenCalled()
    expect(mockExtractContent).not.toHaveBeenCalled()
  })

  it('handles 304 not modified response (preserves existing errors)', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([], { notModified: true }))

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(0)
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: false,
        crawlResult: '304 not modified',
      }),
    )
  })

  it('persists cache headers from RSS response', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([], { etag: '"abc123"', lastModified: 'Sat, 01 Jan 2024 00:00:00 GMT' }))

    await crawlFeed('feed-1')

    expect(mockUpdateFeedCacheHeaders).toHaveBeenCalledWith('feed-1', {
      etag: '"abc123"',
      lastModified: 'Sat, 01 Jan 2024 00:00:00 GMT',
    })
  })

  it('passes stored cache headers to parseFeed', async () => {
    const feedWithCache = { ...sampleFeed, lastEtag: '"old-etag"', lastModified: 'Fri, 01 Dec 2023 00:00:00 GMT' }
    mockGetFeedById.mockResolvedValue(feedWithCache)
    mockParseFeed.mockResolvedValue(rssResult([]))

    await crawlFeed('feed-1')

    expect(mockParseFeed).toHaveBeenCalledWith('https://example.com/feed', {
      etag: '"old-etag"',
      lastModified: 'Fri, 01 Dec 2023 00:00:00 GMT',
    })
  })

  it('skips already-existing URLs', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/old', title: 'Old', datePublished: null, description: null },
        { url: 'https://example.com/new', title: 'New', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set(['https://example.com/old']))
    mockExtractContent.mockResolvedValue({
      title: 'New Article',
      content: 'Some content',
      datePublished: null,
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    expect(result.skipped).toBe(1)
    expect(result.newStories).toBe(1)
    expect(mockCreateStory).toHaveBeenCalledTimes(1)
  })

  it('counts extraction failures as errors', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/fail', title: 'Fail', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue(null)

    const result = await crawlFeed('feed-1')

    expect(result.errors).toBe(1)
    expect(result.newStories).toBe(0)
    expect(mockCreateStory).not.toHaveBeenCalled()
  })

  it('builds error message when extraction failures occur', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/a', title: 'A', datePublished: null, description: null },
        { url: 'https://example.com/b', title: 'B', datePublished: null, description: null },
        { url: 'https://example.com/c', title: 'C', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent
      .mockResolvedValueOnce({ title: 'A', content: 'Content', datePublished: null, method: 'readability' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    expect(result.errors).toBe(2)
    expect(result.errorMessage).toBe('2 of 3 articles failed extraction')
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: true,
        errorMessage: '2 of 3 articles failed extraction',
        newItemCount: 3,
        rssItemCount: 3,
      }),
    )
  })

  it('clears error on successful crawl with no failures', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/a', title: 'A', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'A',
      content: 'Content',
      datePublished: null,
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    expect(result.errorMessage).toBeUndefined()
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: true,
        errorMessage: undefined,
        newItemCount: 1,
        rssItemCount: 1,
        crawlResult: '1 new article',
      }),
    )
  })

  it('reports total failure when all articles fail extraction', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/a', title: 'A', datePublished: null, description: null },
        { url: 'https://example.com/b', title: 'B', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue(null)

    const result = await crawlFeed('feed-1')

    expect(result.errors).toBe(2)
    expect(result.newStories).toBe(0)
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: false,
        errorMessage: '2 of 2 articles failed extraction',
        newItemCount: 2,
        rssItemCount: 2,
      }),
    )
  })

  it('uses extracted title over RSS title', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/article', title: 'RSS Title', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'Better Title',
      content: 'Content here',
      datePublished: '2024-01-15',
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    await crawlFeed('feed-1')

    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ sourceTitle: 'Better Title' }))
  })

  it('passes extraction method to createStory', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/a', title: 'A', datePublished: null, description: null },
        { url: 'https://example.com/b', title: 'B', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent
      .mockResolvedValueOnce({ title: 'A', content: 'Content', datePublished: null, method: 'selector' })
      .mockResolvedValueOnce({ title: 'B', content: 'Content', datePublished: null, method: 'diffbot' })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    await crawlFeed('feed-1')

    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://example.com/a', crawlMethod: 'selector' }))
    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://example.com/b', crawlMethod: 'diffbot' }))
  })

  it('does not claim success when all items are skipped (preserves previous error)', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/old1', title: 'Old 1', datePublished: null, description: null },
        { url: 'https://example.com/old2', title: 'Old 2', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set(['https://example.com/old1', 'https://example.com/old2']))

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(0)
    expect(result.skipped).toBe(2)
    // hadSuccess should be false (0 new > 0 is false), so updateCrawlStatus
    // won't clear existing error fields
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: false,
        errorMessage: undefined,
        newItemCount: 0,
        rssItemCount: 2,
      }),
    )
  })

  it('clears error when crawl has genuine new successes', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/new1', title: 'New 1', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'New 1',
      content: 'Content',
      datePublished: null,
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(1)
    // hadSuccess is true, so updateCrawlStatus will clear error fields
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith(
      'feed-1',
      expect.objectContaining({
        hadSuccess: true,
        errorMessage: undefined,
      }),
    )
  })

  it('deduplicates items within the same RSS batch', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(
      rssResult([
        { url: 'https://example.com/article', title: 'First', datePublished: null, description: null },
        { url: 'https://example.com/article', title: 'Duplicate', datePublished: null, description: null },
      ]),
    )
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'Article',
      content: 'Content',
      datePublished: null,
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(1)
    expect(result.skipped).toBe(1)
    expect(mockExtractContent).toHaveBeenCalledTimes(1)
    expect(mockCreateStory).toHaveBeenCalledTimes(1)
  })

  it('handles P2002 unique constraint as skip instead of error', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/race', title: 'Race', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'Race',
      content: 'Content',
      datePublished: null,
      method: 'readability',
    })
    const prismaError = new Error('Unique constraint failed') as any
    prismaError.code = 'P2002'
    mockCreateStory.mockRejectedValue(prismaError)

    const result = await crawlFeed('feed-1')

    expect(result.errors).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.newStories).toBe(0)
  })

  it('passes htmlSelector to extractor', async () => {
    const feedWithSelector = { ...sampleFeed, htmlSelector: '.article-body' }
    mockGetFeedById.mockResolvedValue(feedWithSelector)
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/a', title: 'A', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'A',
      content: 'Content',
      datePublished: null,
      method: 'selector',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    await crawlFeed('feed-1')

    expect(mockExtractContent).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({ htmlSelector: '.article-body', skipLocalExtraction: false }),
    )
  })

  it('skips local extraction after consecutive API-only successes reach threshold', async () => {
    const batch = config.concurrency.crawlArticles
    const threshold = config.crawl.localFailThreshold
    // Articles in concurrent batches all check skipLocal before any finish,
    // so the threshold takes effect at the next batch boundary.
    const articlesBeforeSkip = batch * Math.ceil(threshold / batch)
    const totalArticles = articlesBeforeSkip + 1

    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: totalArticles }, (_, i) => ({
      url: `https://example.com/art-${i}`,
      title: `Art ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    // All return API method (diffbot) — each increments localFailCount
    mockExtractContent.mockResolvedValue({
      title: 'T',
      content: 'Content',
      datePublished: null,
      method: 'diffbot',
    })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    await crawlFeed('feed-1')

    const calls = mockExtractContent.mock.calls
    expect(calls).toHaveLength(totalArticles)
    // Articles before threshold batch boundary: skipLocalExtraction=false
    for (let i = 0; i < articlesBeforeSkip; i++) {
      expect(calls[i][1]).toMatchObject({ skipLocalExtraction: false })
    }
    // Articles after threshold: skipLocalExtraction=true
    for (let i = articlesBeforeSkip; i < totalArticles; i++) {
      expect(calls[i][1]).toMatchObject({ skipLocalExtraction: true })
    }
  })

  it('skips remaining articles after consecutive total extraction failures', async () => {
    const batch = config.concurrency.crawlArticles
    const threshold = config.crawl.totalFailThreshold
    // Concurrent batches all call extractContent before any can set skipAll.
    // The batch that pushes totalFailCount ≥ threshold is fully attempted.
    const expectedCalls = batch * Math.ceil(threshold / batch)
    const totalArticles = expectedCalls + batch // extra articles to verify they're skipped

    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: totalArticles }, (_, i) => ({
      url: `https://example.com/art-${i}`,
      title: `Art ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    // All extractions return null (total failure)
    mockExtractContent.mockResolvedValue(null)

    const result = await crawlFeed('feed-1')

    // Only articles in batches up to (and including) the threshold batch call extractContent
    expect(mockExtractContent).toHaveBeenCalledTimes(expectedCalls)
    expect(result.errors).toBe(totalArticles)
  })

  it('resets total fail count when extraction succeeds', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: 6 }, (_, i) => ({
      url: `https://example.com/art-${i}`,
      title: `Art ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    // First 2 fail, 3rd succeeds, 4th+5th+6th fail
    mockExtractContent
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'diffbot' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    const result = await crawlFeed('feed-1')

    // All 6 should be attempted: the success at article 3 resets totalFailCount.
    // After articles 4-6 fail (count=3), skipAll would be true but there are no more articles.
    expect(mockExtractContent).toHaveBeenCalledTimes(6)
    expect(result.newStories).toBe(1)
    expect(result.errors).toBe(5)
  })

  it('resets local fail count when a local extraction method succeeds', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: 5 }, (_, i) => ({
      url: `https://example.com/art-${i}`,
      title: `Art ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    // First 2 → diffbot, 3rd → readability (resets counter), 4th+5th → diffbot
    mockExtractContent
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'diffbot' })
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'diffbot' })
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'readability' })
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'diffbot' })
      .mockResolvedValueOnce({ title: 'T', content: 'C', datePublished: null, method: 'diffbot' })
    mockCreateStory.mockResolvedValue({ id: 'story-1' })

    await crawlFeed('feed-1')

    const calls = mockExtractContent.mock.calls
    expect(calls).toHaveLength(5)
    // All should have skipLocalExtraction=false because the readability success resets the counter.
    // With concurrency=3, first 3 run together (all false). Article 3 is readability → resets to 0.
    // Articles 4 and 5: counter was reset, so 2 diffbot results → count=2, still < 3.
    for (const call of calls) {
      expect(call[1]).toEqual(expect.objectContaining({ skipLocalExtraction: false }))
    }
  })

  it('passes the feed paywall setting to the extractor and the access tier to createStory', async () => {
    mockGetFeedById.mockResolvedValue({ ...sampleFeed, paywallDetection: false, paywallTitleMarker: '^\\(S\\+\\)' })
    mockParseFeed.mockResolvedValue(rssResult([{ url: 'https://example.com/a', title: 'A', datePublished: null, description: null }]))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({ title: 'A', content: 'C', datePublished: null, method: 'readability', accessTier: 'locked' })
    mockCreateStory.mockResolvedValue({ id: 'story-1', status: 'rejected' })

    await crawlFeed('feed-1')

    expect(mockExtractContent).toHaveBeenCalledWith(
      'https://example.com/a',
      expect.objectContaining({
        paywall: { detection: false, titleMarker: '^\\(S\\+\\)' },
      }),
    )
    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ accessTier: 'locked' }))
  })

  it('counts a teaser result as a local success, so locked teasers in a row do not set skip-local', async () => {
    const threshold = config.crawl.localFailThreshold
    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: threshold + 2 }, (_, i) => ({
      url: `https://example.com/locked-${i}`,
      title: `Locked ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({ title: 'T', content: '', datePublished: null, method: 'teaser', accessTier: 'locked' })
    mockCreateStory.mockResolvedValue({ id: 'story-1', status: 'rejected' })

    const result = await crawlFeed('feed-1')

    expect(result.newStories).toBe(threshold + 2)
    for (const call of mockExtractContent.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ skipLocalExtraction: false }))
    }
  })

  describe('a feed whose article text comes from its RSS items', () => {
    const rssFeed = { ...sampleFeed, contentSource: 'rss' }
    const fullText = 'A paragraph of the full post. '.repeat(20)

    function rssItem(url: string, contentHtml: string | null, title = 'Post') {
      return { url, title, datePublished: '2026-10-30T08:00:00.000Z', description: 'Teaser', contentHtml }
    }

    beforeEach(() => {
      mockGetExistingUrls.mockResolvedValue(new Set())
      mockCreateStory.mockResolvedValue({ id: 'story-1' })
    })

    it('creates the story from the item HTML and never fetches the page', async () => {
      mockGetFeedById.mockResolvedValue(rssFeed)
      mockParseFeed.mockResolvedValue(rssResult([rssItem('https://writer.substack.com/p/post', `<p>${fullText}</p><p>End.</p>`)]))

      const result = await crawlFeed('feed-1')

      expect(mockExtractContent).not.toHaveBeenCalled()
      expect(result).toMatchObject({ newStories: 1, skipped: 0, errors: 0 })
      expect(mockCreateStory).toHaveBeenCalledWith({
        sourceUrl: 'https://writer.substack.com/p/post',
        sourceTitle: 'Post',
        sourceContent: `${fullText.trim()}\n\nEnd.`,
        feedId: 'feed-1',
        sourceDatePublished: '2026-10-30T08:00:00.000Z',
        crawlMethod: 'rss',
        accessTier: 'unknown',
      })
    })

    it('skips an item whose text is too short, without an error, a page fetch or a failed crawl', async () => {
      mockGetFeedById.mockResolvedValue(rssFeed)
      mockParseFeed.mockResolvedValue(
        rssResult([rssItem('https://writer.substack.com/p/paid', '<p>Only the preview.</p>'), rssItem('https://writer.substack.com/p/none', null)]),
      )

      const result = await crawlFeed('feed-1')

      expect(result).toMatchObject({ newStories: 0, skipped: 2, errors: 0 })
      expect(result.errorMessage).toBeUndefined()
      expect(mockExtractContent).not.toHaveBeenCalled()
      expect(mockCreateStory).not.toHaveBeenCalled()
      // Nothing was attempted, so the crawl is "nothing new", not a total failure retried next run.
      expect(mockUpdateCrawlStatus).toHaveBeenCalledWith('feed-1', expect.objectContaining({ hadSuccess: false, newItemCount: 0, rssItemCount: 2 }))
    })

    it('stores an item whose title matches the feed title marker as locked', async () => {
      mockGetFeedById.mockResolvedValue({ ...rssFeed, paywallTitleMarker: '^\\(S\\+\\)' })
      mockParseFeed.mockResolvedValue(rssResult([rssItem('https://example.com/s-plus', `<p>${fullText}</p>`, '(S+) Subscriber piece')]))

      await crawlFeed('feed-1')

      expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ crawlMethod: 'rss', accessTier: 'locked' }))
    })

    it('counts a concurrent insert of the same URL as a skip and a failed insert as an error', async () => {
      mockGetFeedById.mockResolvedValue(rssFeed)
      mockParseFeed.mockResolvedValue(
        rssResult([rssItem('https://example.com/raced', `<p>${fullText}</p>`), rssItem('https://example.com/broken', `<p>${fullText}</p>`)]),
      )
      mockCreateStory
        .mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
        .mockRejectedValueOnce(new Error('connection lost'))

      const result = await crawlFeed('feed-1')

      expect(result).toMatchObject({ newStories: 0, skipped: 1, errors: 1, errorMessage: '1 of 2 articles failed extraction' })
    })
  })

  it('counts an API-tier result the HTML classified as locked as a local success', async () => {
    const threshold = config.crawl.localFailThreshold
    mockGetFeedById.mockResolvedValue(sampleFeed)
    const items = Array.from({ length: threshold + 2 }, (_, i) => ({
      url: `https://example.com/locked-api-${i}`,
      title: `Locked ${i}`,
      datePublished: null,
      description: null,
    }))
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({ title: 'T', content: 'Short API text', datePublished: null, method: 'diffbot', accessTier: 'locked' })
    mockCreateStory.mockResolvedValue({ id: 'story-1', status: 'rejected' })

    await crawlFeed('feed-1')

    for (const call of mockExtractContent.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ skipLocalExtraction: false }))
    }
  })
})

describe("crawlFeed and the publisher's opt-out", () => {
  const item = (slug: string) => ({ url: `https://example.com/${slug}`, title: slug, datePublished: null, description: null, contentHtml: null })
  const extracted = { title: 'T', content: 'Content', datePublished: null, method: 'readability', accessTier: 'unknown' }
  const statusUpdate = () => mockUpdateCrawlStatus.mock.calls[0]![1]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockCreateStory.mockResolvedValue({ id: 'story-1' })
    mockExtractContent.mockResolvedValue(extracted)
  })

  it('skips a reserved item without fetching or extracting it, counts it as skipped and shows the reason on the feed', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('reserved'), item('open')]))
    mockCheckOptOut.mockImplementation(async (url: string) => (url.endsWith('/reserved') ? ROBOTS_RESERVED : NOT_RESERVED))

    const result = await crawlFeed('feed-1')

    expect(mockCheckOptOut).toHaveBeenCalledWith('https://example.com/reserved', { fetchesPage: true })
    expect(mockExtractContent).toHaveBeenCalledTimes(1)
    expect(mockExtractContent).toHaveBeenCalledWith('https://example.com/open', expect.anything())
    expect(result).toMatchObject({ newStories: 1, skipped: 1, errors: 0 })
    expect(statusUpdate()).toMatchObject({ hadSuccess: true, newItemCount: 1, errorMessage: expect.stringContaining('robots.txt disallows ActuallyRelevant') })
  })

  it('does not let a feed whose every new item was reserved look healthy', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('a'), item('b')]))
    mockCheckOptOut.mockResolvedValue(ROBOTS_RESERVED)

    const result = await crawlFeed('feed-1')

    expect(mockExtractContent).not.toHaveBeenCalled()
    expect(result).toMatchObject({ newStories: 0, skipped: 2, errors: 0 })
    // Nothing was attempted, so it is not a total failure retried next run; the reason is the feed's error
    expect(statusUpdate()).toMatchObject({ hadSuccess: false, newItemCount: 0, errorMessage: expect.stringContaining('robots.txt disallows ActuallyRelevant') })
    expect(statusUpdate().crawlResult).toBe(statusUpdate().errorMessage)
  })

  it('keeps reserved items out of the skip-local and skip-all counters', async () => {
    const reservedCount = Math.max(config.crawl.localFailThreshold, config.crawl.totalFailThreshold) + 1
    const items = [...Array.from({ length: reservedCount }, (_, i) => item(`reserved-${i}`)), item('open')]
    mockParseFeed.mockResolvedValue(rssResult(items))
    mockCheckOptOut.mockImplementation(async (url: string) => (url.includes('reserved') ? ROBOTS_RESERVED : NOT_RESERVED))

    const result = await crawlFeed('feed-1')

    expect(mockExtractContent).toHaveBeenCalledTimes(1)
    expect(mockExtractContent).toHaveBeenCalledWith('https://example.com/open', expect.objectContaining({ skipLocalExtraction: false }))
    expect(result).toMatchObject({ newStories: 1, skipped: reservedCount, errors: 0 })
  })

  it('reports extraction failures and the opt-out together, the failure count first', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('reserved'), item('fails')]))
    mockCheckOptOut.mockImplementation(async (url: string) => (url.endsWith('/reserved') ? ROBOTS_RESERVED : NOT_RESERVED))
    mockExtractContent.mockResolvedValue(null)

    const result = await crawlFeed('feed-1')

    expect(result.errorMessage).toMatch(/^1 of 1 articles failed extraction; .*robots\.txt disallows ActuallyRelevant/)
  })

  it('asks no extraction API for the rest of the crawl once a page fetch is refused', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('a'), item('b'), item('c')]))
    const apiSkipped: boolean[] = []
    mockExtractContent.mockImplementation(async (url: string, options: { skipApiTier: () => boolean }) => {
      apiSkipped.push(options.skipApiTier())
      return url.endsWith('/a') ? { refusal: 'denied', reason: 'publisher refused the crawler (HTTP 403)' } : extracted
    })

    const result = await crawlFeed('feed-1')

    expect(apiSkipped).toEqual([false, true, true])
    expect(result).toMatchObject({ newStories: 2, errors: 1 })
    expect(result.errorMessage).toMatch(/^1 of 3 articles failed extraction; .*HTTP 403/)
  })

  it('skips a page that carries a reservation, not as an error, and asks no API for the rest of the crawl', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('a'), item('b')]))
    const apiSkipped: boolean[] = []
    mockExtractContent.mockImplementation(async (url: string, options: { skipApiTier: () => boolean }) => {
      apiSkipped.push(options.skipApiTier())
      return url.endsWith('/a') ? { refusal: 'reserved', reason: 'TDMRep reservation (tdm-reservation meta tag)' } : extracted
    })

    const result = await crawlFeed('feed-1')

    expect(apiSkipped).toEqual([false, true])
    expect(result).toMatchObject({ newStories: 1, skipped: 1, errors: 0 })
    expect(statusUpdate()).toMatchObject({ newItemCount: 1, errorMessage: expect.stringContaining('TDMRep reservation') })
  })

  it('names a redirect target whose robots.txt could not be read as an unknown opt-out, not a known one', async () => {
    mockParseFeed.mockResolvedValue(rssResult([item('a')]))
    mockExtractContent.mockResolvedValue({
      refusal: 'reserved',
      reason: 'robots.txt unreachable (HTTP 503) (redirect target publisher.example)',
      unverified: true,
    })

    const result = await crawlFeed('feed-1')

    expect(result).toMatchObject({ skipped: 1, errors: 0 })
    expect(result.errorMessage).toContain('Publisher opt-out unknown: robots.txt unreachable')
  })

  it('checks the items of a feed that takes its text from RSS without robots.txt path rules, and skips the reserved ones', async () => {
    const fullText = 'A paragraph of the full post. '.repeat(20)
    const rssItem = (slug: string) => ({ ...item(slug), contentHtml: `<p>${fullText}</p>` })
    mockGetFeedById.mockResolvedValue({ ...sampleFeed, contentSource: 'rss' })
    mockParseFeed.mockResolvedValue(rssResult([rssItem('reserved'), rssItem('open')]))
    mockCheckOptOut.mockImplementation(async (url: string) =>
      url.endsWith('/reserved') ? { reserved: true, reason: 'Content-Signal ai-input=no', unverified: false } : NOT_RESERVED,
    )

    const result = await crawlFeed('feed-1')

    expect(mockCheckOptOut).toHaveBeenCalledWith('https://example.com/reserved', { fetchesPage: false })
    expect(mockCheckOptOut).not.toHaveBeenCalledWith(expect.anything(), { fetchesPage: true })
    expect(mockCreateStory).toHaveBeenCalledTimes(1)
    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://example.com/open' }))
    expect(result).toMatchObject({ newStories: 1, skipped: 1, errors: 0 })
    expect(statusUpdate()).toMatchObject({ newItemCount: 1, errorMessage: expect.stringContaining('Content-Signal ai-input=no') })
  })
})

describe('crawlAllDueFeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('crawls all due feeds and returns results', async () => {
    mockGetDueFeeds.mockResolvedValue([
      { id: 'feed-1', title: 'Feed 1' },
      { id: 'feed-2', title: 'Feed 2' },
    ])
    mockGetFeedById
      .mockResolvedValueOnce({ ...sampleFeed, id: 'feed-1', title: 'Feed 1' })
      .mockResolvedValueOnce({ ...sampleFeed, id: 'feed-2', title: 'Feed 2' })
    mockParseFeed.mockResolvedValue(rssResult([]))

    const results = await crawlAllDueFeeds()

    expect(results).toHaveLength(2)
    expect(mockGetDueFeeds).toHaveBeenCalled()
  })

  it('keeps crawling other feeds when one feed cannot be fetched', async () => {
    mockGetDueFeeds.mockResolvedValue([
      { id: 'feed-down', title: 'Down Feed' },
      { id: 'feed-up', title: 'Up Feed' },
    ])
    mockGetFeedById.mockImplementation(async (id: string) => ({ ...sampleFeed, id, rssUrl: `https://example.com/${id}` }))
    mockParseFeed.mockImplementation(async (url: string) => {
      if (url.endsWith('feed-down')) throw new Error('Request failed with status code 503')
      return rssResult([])
    })

    const results = await crawlAllDueFeeds()

    expect(results).toHaveLength(2)
    const down = results.find(r => r.feedId === 'feed-down')
    const up = results.find(r => r.feedId === 'feed-up')
    expect(down?.errors).toBe(1)
    expect(up?.errors).toBe(0)
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith('feed-down', expect.objectContaining({ fetchFailed: true }))
    expect(mockUpdateCrawlStatus).toHaveBeenCalledWith('feed-up', expect.objectContaining({ hadSuccess: true, rssItemCount: 0 }))
  })

  it('handles individual feed crawl failures gracefully', async () => {
    mockGetDueFeeds.mockResolvedValue([{ id: 'feed-bad', title: 'Bad Feed' }])
    mockGetFeedById.mockResolvedValue(null)

    const results = await crawlAllDueFeeds()

    expect(results).toHaveLength(1)
    expect(results[0].errors).toBe(1)
    expect(results[0].feedTitle).toBe('Bad Feed')
  })

  it('records a crawl that throws as a failed crawl, without inventing a new item', async () => {
    mockGetDueFeeds.mockResolvedValue([{ id: 'feed-bad', title: 'Bad Feed' }])
    mockGetFeedById.mockResolvedValue(null)

    const results = await crawlAllDueFeeds()

    expect(results[0].errorMessage).toMatch(/^Crawl failed: /)
    const outcome = mockUpdateCrawlStatus.mock.calls.find(c => c[0] === 'feed-bad')?.[1]
    expect(outcome).toMatchObject({ hadSuccess: false, fetchFailed: true, newItemCount: 0 })
    expect(outcome.errorMessage).toMatch(/^Crawl failed: /)
  })
})

describe('crawlUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when feed not found', async () => {
    mockGetFeedById.mockResolvedValue(null)
    await expect(crawlUrl('https://example.com/article', 'bad-feed')).rejects.toThrow('Feed not found')
  })

  it('throws when URL already crawled', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set(['https://example.com/article']))

    await expect(crawlUrl('https://example.com/article', 'feed-1')).rejects.toThrow('URL already crawled')
  })

  it('refuses a feed whose article text comes from its RSS items, without fetching the page', async () => {
    mockGetFeedById.mockResolvedValue({ ...sampleFeed, contentSource: 'rss' })
    mockGetExistingUrls.mockResolvedValue(new Set())

    const refused = crawlUrl('https://writer.substack.com/p/post', 'feed-1')

    await expect(refused).rejects.toBeInstanceOf(BadRequestError)
    await expect(refused).rejects.toThrow("This feed takes article text from its RSS feed; single URLs can't be crawled")
    expect(mockExtractContent).not.toHaveBeenCalled()
    expect(mockCreateStory).not.toHaveBeenCalled()
  })

  it('refuses a reserved URL with 400 and the reason, before any page fetch', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockCheckOptOut.mockResolvedValue(ROBOTS_RESERVED)

    const refused = crawlUrl('https://example.com/article', 'feed-1')

    await expect(refused).rejects.toBeInstanceOf(BadRequestError)
    await expect(refused).rejects.toThrow('robots.txt disallows ActuallyRelevant')
    expect(mockCheckOptOut).toHaveBeenCalledWith('https://example.com/article', { fetchesPage: true })
    expect(mockExtractContent).not.toHaveBeenCalled()
    expect(mockCreateStory).not.toHaveBeenCalled()
  })

  it('refuses a page that turns out to carry a reservation with 400, and a refused fetch with 422', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockImplementation(async (url: string) =>
      url.endsWith('/a')
        ? { refusal: 'reserved', reason: 'TDMRep reservation (tdm-reservation header)' }
        : { refusal: 'denied', reason: 'publisher refused the crawler (HTTP 403)' },
    )

    await expect(crawlUrl('https://example.com/a', 'feed-1')).rejects.toSatisfy(err => err instanceof BadRequestError && /TDMRep/.test(err.message))
    await expect(crawlUrl('https://example.com/b', 'feed-1')).rejects.toSatisfy(err => err instanceof UnprocessableError && /HTTP 403/.test(err.message))
    expect(mockCreateStory).not.toHaveBeenCalled()
  })

  it('refuses a URL that redirects to a host whose opt-out could not be read with 400 "Publisher opt-out unknown"', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      refusal: 'reserved',
      reason: 'robots.txt unreachable (HTTP 503) (redirect target publisher.example)',
      unverified: true,
    })

    await expect(crawlUrl('https://example.com/a', 'feed-1')).rejects.toSatisfy(
      err => err instanceof BadRequestError && /^Publisher opt-out unknown/.test(err.message),
    )
  })

  it('returns null when extraction fails', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue(null)

    const result = await crawlUrl('https://example.com/article', 'feed-1')
    expect(result).toBeNull()
  })

  it('creates story and returns storyId on success', async () => {
    mockGetFeedById.mockResolvedValue(sampleFeed)
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({
      title: 'Article Title',
      content: 'Article content',
      datePublished: '2024-01-15',
      method: 'readability',
    })
    mockCreateStory.mockResolvedValue({ id: 'new-story-id' })

    const result = await crawlUrl('https://example.com/article', 'feed-1')

    expect(result).toEqual({ storyId: 'new-story-id' })
    expect(mockCreateStory).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://example.com/article',
        sourceTitle: 'Article Title',
        sourceContent: 'Article content',
        feedId: 'feed-1',
        crawlMethod: 'readability',
      }),
    )
  })

  it('passes the feed paywall setting and the access tier through', async () => {
    mockGetFeedById.mockResolvedValue({ ...sampleFeed, paywallTitleMarker: 'Z\\+' })
    mockGetExistingUrls.mockResolvedValue(new Set())
    mockExtractContent.mockResolvedValue({ title: 'T', content: 'C', datePublished: null, method: 'teaser', accessTier: 'locked' })
    mockCreateStory.mockResolvedValue({ id: 'locked-story' })

    await crawlUrl('https://example.com/article', 'feed-1')

    expect(mockExtractContent).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({
        paywall: { detection: true, titleMarker: 'Z\\+' },
      }),
    )
    expect(mockCreateStory).toHaveBeenCalledWith(expect.objectContaining({ accessTier: 'locked', crawlMethod: 'teaser' }))
  })
})
