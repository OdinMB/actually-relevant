import type { Feed } from '@shared/types'
import type { FeedQualityMetrics } from '../../lib/admin-api'

/**
 * Which active feeds have problems, from what the Feeds page already loads: the feed's crawl state
 * (`.context/feed-management.md`, "Crawl Status and Health Counters") and its quality metrics. The
 * feed export and its agent prompts use it (`feedExport.ts`).
 */

export type FeedProblem = 'rss-fetch-failed' | 'extraction-failing' | 'stale' | 'nothing-analyzed'

/** What each problem code means, written into the export for the agent that reads it. */
export const FEED_PROBLEM_DEFINITIONS: Record<FeedProblem, string> = {
  'rss-fetch-failed': 'The most recent crawl could not fetch or parse the RSS feed (lastCrawlResult starts with "RSS fetch failed").',
  'extraction-failing': 'The last crawl error says more than half of the new articles failed text extraction ("N of M articles failed extraction").',
  stale: 'The feed returned no items, or could not be fetched, in each of its recent crawls (consecutiveEmptyCrawls).',
  'nothing-analyzed': 'Stories were crawled from the feed, but none was ever published and none of those still stored reached analysis.',
}

type CrawlState = Pick<Feed, 'active' | 'lastCrawlResult' | 'lastCrawlError' | 'isStale'>

/** The crawler's error for a crawl in which some articles failed extraction (`server/src/services/crawler.ts`). */
const EXTRACTION_FAILURES = /^(\d+) of (\d+) articles failed extraction$/

function mostArticlesFailed(error: string | null): boolean {
  const match = error ? EXTRACTION_FAILURES.exec(error) : null
  if (!match) return false
  const failed = Number(match[1])
  const total = Number(match[2])
  return total > 0 && failed / total > 0.5
}

function nothingAnalyzed(quality: FeedQualityMetrics | undefined): boolean {
  return !!quality && quality.totalCrawled > 0 && quality.publishedCount === 0 && quality.avgRelevance === null
}

/** The problems of a feed, in a fixed order; none for an inactive feed, which is not crawled. */
export function findFeedProblems(feed: CrawlState, quality: FeedQualityMetrics | undefined): FeedProblem[] {
  if (!feed.active) return []
  const checks: [FeedProblem, boolean][] = [
    ['rss-fetch-failed', feed.lastCrawlResult?.startsWith('RSS fetch failed') ?? false],
    ['extraction-failing', mostArticlesFailed(feed.lastCrawlError)],
    ['stale', feed.isStale],
    ['nothing-analyzed', nothingAnalyzed(quality)],
  ]
  return checks.filter(([, found]) => found).map(([problem]) => problem)
}
