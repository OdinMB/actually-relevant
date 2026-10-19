/**
 * Admin and pipeline reads of stories: the admin list and its filters, single-story and by-id
 * fetches, status counts, the pipeline's "ids in this status" query and the crawler's URL check.
 */
import prisma from '../lib/prisma.js'
import { Prisma, StoryStatus, EmotionTag } from '@prisma/client'
import { paginate } from '../lib/paginate.js'
import { normalizeUrl } from '../utils/urlNormalization.js'

interface StoryFilters {
  status?: string
  issueId?: string
  feedId?: string
  crawledAfter?: string
  crawledBefore?: string
  ratingMin?: number
  ratingMax?: number
  rating?: string
  emotionTag?: string
  accessTier?: 'locked' | 'metered'
  search?: string
  sort?: string
  page?: number
  pageSize?: number
}

const SORT_MAP: Record<string, Prisma.StoryOrderByWithRelationInput> = {
  rating_asc: { relevance: 'asc' },
  rating_desc: { relevance: 'desc' },
  date_asc: { dateCrawled: 'asc' },
  date_desc: { dateCrawled: 'desc' },
  title_asc: { title: 'asc' },
  title_desc: { title: 'desc' },
}

function buildWhereClause(filters: StoryFilters): Prisma.StoryWhereInput {
  const where: Prisma.StoryWhereInput = {}
  const conditions: Prisma.StoryWhereInput[] = []

  if (filters.status === 'all') {
    // No status filter — show everything including trashed
  } else if (filters.status) {
    where.status = filters.status as StoryStatus
  } else {
    where.status = { not: StoryStatus.trashed }
  }
  if (filters.feedId) {
    where.feedId = filters.feedId
  }
  if (filters.issueId) {
    conditions.push({
      OR: [
        { issueId: filters.issueId },
        { issue: { parentId: filters.issueId } },
        {
          issueId: null,
          feed: { issue: { OR: [{ id: filters.issueId }, { parentId: filters.issueId }] } },
        },
      ],
    })
  }
  if (filters.crawledAfter || filters.crawledBefore) {
    where.dateCrawled = {}
    if (filters.crawledAfter) where.dateCrawled.gte = new Date(filters.crawledAfter)
    if (filters.crawledBefore) where.dateCrawled.lte = new Date(filters.crawledBefore)
  }
  if (filters.ratingMin !== undefined || filters.ratingMax !== undefined) {
    where.relevance = {}
    if (filters.ratingMin !== undefined) where.relevance.gte = filters.ratingMin
    if (filters.ratingMax !== undefined) where.relevance.lte = filters.ratingMax
  }
  if (filters.rating) {
    const match = filters.rating.match(/^(gte|lte)(\d+)$/)
    if (match) {
      const op = match[1] as 'gte' | 'lte'
      const val = parseInt(match[2]!, 10)
      const condition = { [op]: val }
      conditions.push({
        OR: [
          { relevance: condition },
          { relevance: null, relevancePre: condition },
        ],
      })
    }
  }
  if (filters.emotionTag) {
    where.emotionTag = filters.emotionTag as EmotionTag
  }
  if (filters.accessTier) {
    where.accessTier = filters.accessTier
  }
  if (filters.search) {
    conditions.push({
      OR: [
        { title: { contains: filters.search, mode: 'insensitive' as const } },
        { sourceTitle: { contains: filters.search, mode: 'insensitive' as const } },
        { summary: { contains: filters.search, mode: 'insensitive' as const } },
      ],
    })
  }

  if (conditions.length > 0) {
    where.AND = conditions
  }

  return where
}

/**
 * The admin list's where clause for published stories only, with its issue, date and text-search
 * semantics (the podcast's story finder uses it, so the two never drift apart).
 */
export function publishedStoryWhere(filters: Pick<StoryFilters, 'issueId' | 'crawledAfter' | 'crawledBefore' | 'search'>): Prisma.StoryWhereInput {
  return buildWhereClause({ ...filters, status: StoryStatus.published })
}

const ADMIN_LIST_SELECT = {
  id: true,
  sourceUrl: true,
  sourceTitle: true,
  sourceDatePublished: true,
  feedId: true,
  status: true,
  rejectionReason: true,
  dateCrawled: true,
  datePublished: true,
  relevancePre: true,
  relevance: true,
  emotionTag: true,
  slug: true,
  title: true,
  titleLabel: true,
  summary: true,
  quote: true,
  quoteAttribution: true,
  marketingBlurb: true,
  relevanceReasons: true,
  antifactors: true,
  relevanceCalculation: true,
  issueId: true,
  issue: { select: { id: true, name: true, slug: true } },
  crawlMethod: true,
  accessTier: true,
  clusterId: true,
  cluster: { select: { primaryStoryId: true } },
  createdAt: true,
  updatedAt: true,
  feed: { select: { id: true, title: true, issue: { select: { id: true, name: true, slug: true } } } },
  _count: { select: { blueskyPosts: true, mastodonPosts: true } },
} as const

export async function getStories(filters: StoryFilters) {
  const page = filters.page || 1
  const pageSize = filters.pageSize || 25
  const where = buildWhereClause(filters)
  const orderBy = filters.sort ? SORT_MAP[filters.sort] : { dateCrawled: 'desc' as const }

  return paginate({
    findMany: () =>
      prisma.story.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: ADMIN_LIST_SELECT,
      }),
    count: () => prisma.story.count({ where }),
    page,
    pageSize,
  })
}

export async function getStoriesByIds(ids: string[]) {
  if (ids.length === 0) return []
  return prisma.story.findMany({
    where: { id: { in: ids } },
    select: {
      ...ADMIN_LIST_SELECT,
      issue: {
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          parent: { select: { id: true, name: true, slug: true } },
        },
      },
      feed: {
        select: {
          id: true,
          title: true,
          issue: {
            select: {
              id: true,
              name: true,
              slug: true,
              parentId: true,
              parent: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
    },
  })
}

export async function getStoryById(id: string) {
  return prisma.story.findUnique({
    where: { id },
    include: {
      issue: true,
      feed: { include: { issue: true } },
      cluster: {
        include: {
          _count: { select: { stories: true } },
          stories: {
            select: { id: true, title: true, sourceTitle: true, status: true },
            orderBy: { dateCrawled: 'asc' },
          },
        },
      },
      _count: { select: { blueskyPosts: true, mastodonPosts: true } },
      blueskyPosts: {
        where: { status: 'published' },
        select: { postUri: true },
        take: 1,
        orderBy: { publishedAt: 'desc' },
      },
      mastodonPosts: {
        where: { status: 'published' },
        select: { statusUrl: true },
        take: 1,
        orderBy: { publishedAt: 'desc' },
      },
    },
  })
}

export async function getExistingUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  const normalized = urls.map(normalizeUrl)
  const existing = await prisma.story.findMany({
    where: { sourceUrl: { in: normalized } },
    select: { sourceUrl: true },
  })
  return new Set(existing.map(s => s.sourceUrl))
}

export async function getStoryStats() {
  const stats = await prisma.story.groupBy({
    by: ['status'],
    _count: { status: true },
  })
  return stats.reduce((acc, row) => {
    acc[row.status] = row._count.status
    return acc
  }, {} as Record<string, number>)
}

interface StatusFilterOptions {
  ratingMin?: number
  relevanceMin?: number
  hoursAgo?: number
  issueId?: string | null
  limit?: number
}

function buildStatusWhereClause(
  status: string,
  options: StatusFilterOptions = {},
): Prisma.StoryWhereInput {
  const where: Prisma.StoryWhereInput = { status: status as StoryStatus }
  if (options.ratingMin !== undefined) {
    where.relevancePre = { gte: options.ratingMin }
  }
  if (options.relevanceMin !== undefined) {
    where.relevance = { gte: options.relevanceMin }
  }
  if (options.hoursAgo !== undefined) {
    where.dateCrawled = { gte: new Date(Date.now() - options.hoursAgo * 60 * 60 * 1000) }
  }
  if (options.issueId !== undefined) {
    where.issueId = options.issueId
  }
  return where
}

export async function getStoryIdsByStatus(
  status: string,
  options: StatusFilterOptions = {},
): Promise<string[]> {
  const where = buildStatusWhereClause(status, options)
  const stories = await prisma.story.findMany({
    where,
    select: { id: true },
    orderBy: { dateCrawled: 'desc' },
    ...(options.limit ? { take: options.limit } : {}),
  })
  return stories.map(s => s.id)
}
