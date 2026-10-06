import { describe, it, expect, vi, beforeEach } from 'vitest'
import { config } from '../config.js'

const mockPrisma = vi.hoisted(() => ({
  feed: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { updateCrawlStatus, isFeedStale } = await import('./feed.js')

function updatedData(): Record<string, unknown> {
  return mockPrisma.feed.update.mock.calls[0][0].data
}

describe('updateCrawlStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.feed.update.mockResolvedValue({})
    mockPrisma.feed.findUnique.mockResolvedValue({ consecutiveFailedCrawls: 0 })
  })

  it('records an RSS fetch failure as an error, counts it as a failed and an empty crawl, and retries next run', async () => {
    await updateCrawlStatus('feed-1', {
      hadSuccess: false,
      fetchFailed: true,
      errorMessage: 'RSS fetch failed: timeout',
      newItemCount: 0,
      rssItemCount: 0,
    })

    const data = updatedData()
    expect(data.lastCrawlError).toBe('RSS fetch failed: timeout')
    expect(data.lastCrawlErrorAt).toBeInstanceOf(Date)
    expect(data.consecutiveFailedCrawls).toBe(1)
    expect(data.consecutiveEmptyCrawls).toEqual({ increment: 1 })
    expect(data).not.toHaveProperty('lastCrawledAt')
    expect(data).not.toHaveProperty('lastSuccessfulCrawlAt')
  })

  it('advances lastCrawledAt after the maximum consecutive fetch failures', async () => {
    mockPrisma.feed.findUnique.mockResolvedValue({ consecutiveFailedCrawls: 2 })

    await updateCrawlStatus('feed-1', {
      hadSuccess: false,
      fetchFailed: true,
      errorMessage: 'RSS fetch failed: timeout',
      newItemCount: 0,
      rssItemCount: 0,
    })

    const data = updatedData()
    expect(data.lastCrawledAt).toBeInstanceOf(Date)
    expect(data.consecutiveFailedCrawls).toBe(0)
  })

  it('counts a reachable but empty feed as empty, not as failed', async () => {
    await updateCrawlStatus('feed-1', {
      hadSuccess: true,
      newItemCount: 0,
      rssItemCount: 0,
      crawlResult: 'No items in feed',
    })

    const data = updatedData()
    expect(data.lastCrawlError).toBeNull()
    expect(data.consecutiveFailedCrawls).toBe(0)
    expect(data).not.toHaveProperty('lastSuccessfulCrawlAt')
    expect(data.consecutiveEmptyCrawls).toEqual({ increment: 1 })
    expect(data.lastCrawledAt).toBeInstanceOf(Date)
  })
})

describe('isFeedStale', () => {
  const threshold = config.crawl.staleAfterEmptyCrawls

  it('is stale from the configured number of consecutive empty crawls', () => {
    expect(isFeedStale(threshold - 1)).toBe(false)
    expect(isFeedStale(threshold)).toBe(true)
    expect(isFeedStale(threshold + 1)).toBe(true)
  })
})
