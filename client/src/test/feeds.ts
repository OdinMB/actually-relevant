import type { Feed, Issue } from '@shared/types'
import type { FeedQualityMetrics } from '../lib/admin-api'

/** A healthy active feed, as the admin feed list returns it; override what a test is about. */
export function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 'feed-1',
    title: 'Healthy Feed',
    rssUrl: 'https://healthy.example/feed.xml',
    url: 'https://healthy.example/',
    displayTitle: null,
    language: 'en',
    region: null,
    issueId: 'i-planet',
    active: true,
    crawlIntervalHours: 6,
    lastCrawledAt: '2026-10-31T08:00:00.000Z',
    lastCrawlError: null,
    lastCrawlErrorAt: null,
    consecutiveFailedCrawls: 0,
    consecutiveEmptyCrawls: 0,
    isStale: false,
    lastSuccessfulCrawlAt: '2026-10-31T08:00:00.000Z',
    lastEtag: null,
    lastModified: null,
    lastCrawlResult: '3 new articles',
    htmlSelector: null,
    paywallDetection: true,
    paywallTitleMarker: null,
    contentSource: 'page',
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-10-31T08:00:00.000Z',
    ...overrides,
  }
}

/** Quality metrics of a feed whose stories get analyzed and published. */
export function makeQuality(overrides: Partial<FeedQualityMetrics> = {}): FeedQualityMetrics {
  return {
    totalCrawled: 40,
    archivedCount: 10,
    avgRelevancePre: 4.1,
    publishedCount: 8,
    publishRate: 0.2,
    avgRelevance: 5.3,
    extractionMethods: { readability: 25, jina: 5 },
    ...overrides,
  }
}

/** Two top-level issues, one with a sub-issue, in no particular order. */
export const feedIssues = [
  { id: 'i-planet', name: 'Planet & Climate', slug: 'planet-climate', parentId: null },
  { id: 'i-pandemics', name: 'Pandemics', slug: 'pandemics', parentId: 'i-health' },
  { id: 'i-health', name: 'Health', slug: 'health', parentId: null },
] as unknown as Issue[]
