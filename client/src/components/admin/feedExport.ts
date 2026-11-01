import type { Feed, FeedContentSource, FeedRegion } from '@shared/types'
import type { FeedQualityMetrics } from '../../lib/admin-api'
import { issueTree, type IssueNode } from '../../lib/issues'
import { dominantMethod } from './feedQuality'
import { FEED_PROBLEM_DEFINITIONS, findFeedProblems, type FeedProblem } from './feedProblems'

/**
 * The feed export of the Feeds page: the feeds with problems, or every feed, with their settings,
 * crawl state and quality metrics, plus the issue tree. An AI agent reads it to fix feeds or find
 * coverage gaps (`feedExportPrompts.ts`) and answers with a changeset (`.context/feed-management.md`,
 * "Export").
 */

export type FeedExportScope = 'problems' | 'all'

export interface FeedExportInput {
  /** Every feed, inactive ones included. */
  feeds: Feed[]
  issues: IssueNode[]
  quality: Record<string, FeedQualityMetrics> | undefined
  now: Date
}

export interface FeedExportFeed {
  id: string
  title: string
  displayTitle: string | null
  rssUrl: string
  url: string | null
  /** The issue's slug, as a changeset names it. */
  issue: string | null
  issueName: string | null
  /** For a sub-issue, its parent's name. */
  parentIssueName: string | null
  language: string
  region: FeedRegion | null
  active: boolean
  contentSource: FeedContentSource
  crawlIntervalHours: number
  htmlSelector: string | null
  paywallDetection: boolean
  paywallTitleMarker: string | null
  createdAt: string
  lastCrawledAt: string | null
  lastSuccessfulCrawlAt: string | null
  lastCrawlResult: string | null
  lastCrawlError: string | null
  lastCrawlErrorAt: string | null
  consecutiveFailedCrawls: number
  consecutiveEmptyCrawls: number
  /** The metrics the feed table shows; null when there are none for the feed. */
  quality: { crawled: number; published: number; publishRate: number; avgRelevance: number | null; dominantMethod: string | null } | null
  problems: FeedProblem[]
}

export interface FeedExport {
  scope: FeedExportScope
  exportedAt: string
  problemDefinitions: Record<FeedProblem, string>
  issues: { slug: string; name: string; children: { slug: string; name: string }[] }[]
  feeds: FeedExportFeed[]
}

function exportQuality(metrics: FeedQualityMetrics | undefined): FeedExportFeed['quality'] {
  if (!metrics) return null
  return {
    crawled: metrics.totalCrawled,
    published: metrics.publishedCount,
    publishRate: metrics.publishRate,
    avgRelevance: metrics.avgRelevance,
    dominantMethod: dominantMethod(metrics.extractionMethods),
  }
}

function exportFeed(feed: Feed, issues: Map<string, IssueNode>, metrics: FeedQualityMetrics | undefined): FeedExportFeed {
  const issue = issues.get(feed.issueId)
  const parent = issue?.parentId ? issues.get(issue.parentId) : undefined
  return {
    id: feed.id,
    title: feed.title,
    displayTitle: feed.displayTitle,
    rssUrl: feed.rssUrl,
    url: feed.url,
    issue: issue?.slug ?? null,
    issueName: issue?.name ?? null,
    parentIssueName: parent?.name ?? null,
    language: feed.language,
    region: feed.region,
    active: feed.active,
    contentSource: feed.contentSource,
    crawlIntervalHours: feed.crawlIntervalHours,
    htmlSelector: feed.htmlSelector,
    paywallDetection: feed.paywallDetection,
    paywallTitleMarker: feed.paywallTitleMarker,
    createdAt: feed.createdAt,
    lastCrawledAt: feed.lastCrawledAt,
    lastSuccessfulCrawlAt: feed.lastSuccessfulCrawlAt,
    lastCrawlResult: feed.lastCrawlResult,
    lastCrawlError: feed.lastCrawlError,
    lastCrawlErrorAt: feed.lastCrawlErrorAt,
    consecutiveFailedCrawls: feed.consecutiveFailedCrawls,
    consecutiveEmptyCrawls: feed.consecutiveEmptyCrawls,
    quality: exportQuality(metrics),
    problems: findFeedProblems(feed, metrics),
  }
}

export function buildFeedExport({ feeds, issues, quality, now }: FeedExportInput, scope: FeedExportScope): FeedExport {
  const issuesById = new Map(issues.map(issue => [issue.id, issue]))
  const exported = feeds.map(feed => exportFeed(feed, issuesById, quality?.[feed.id]))
  return {
    scope,
    exportedAt: now.toISOString(),
    problemDefinitions: FEED_PROBLEM_DEFINITIONS,
    issues: issueTree(issues).map(({ parent, children }) => ({
      slug: parent.slug,
      name: parent.name,
      children: children.map(child => ({ slug: child.slug, name: child.name })),
    })),
    feeds: scope === 'all' ? exported : exported.filter(feed => feed.problems.length > 0),
  }
}

/** `feeds-<scope>-YYYY-MM-DD.json`, dated in local time. */
export function feedExportFileName(scope: FeedExportScope, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `feeds-${scope}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
