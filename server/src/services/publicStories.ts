/**
 * Public reads of published stories: the paginated listing (search delegates to storySearch.ts),
 * the story page by slug, cluster redirects and "also covered by" sources, and the homepage buckets.
 */
import prisma from '../lib/prisma.js'
import { Prisma, EmotionTag } from '@prisma/client'
import { paginate } from '../lib/paginate.js'
import { storyInIssueWhere } from '../lib/issueFilter.js'
import { PUBLIC_STORY_SELECT } from './storySelect.js'
import { hybridSearch } from './storySearch.js'

export async function getPublishedStories(options: {
  page?: number
  pageSize?: number
  issueSlug?: string
  search?: string
  emotionTags?: string[]
  /** Inclusive lower bound on datePublished. Not applied to search. */
  publishedSince?: Date
  /** Exclusive upper bound on datePublished. Not applied to search. */
  publishedBefore?: Date
  /** Minimum relevance rating (1-10). Not applied to search. */
  minRelevance?: number
}) {
  const page = options.page || 1
  const pageSize = options.pageSize || 25

  // Use hybrid search when search query is provided (the sync filters above do not apply)
  if (options.search) {
    return hybridSearch({
      query: options.search,
      issueSlug: options.issueSlug,
      page,
      pageSize,
    })
  }

  // Non-search: standard paginated query
  const conditions: Prisma.StoryWhereInput[] = []
  if (options.issueSlug) {
    conditions.push(storyInIssueWhere(options.issueSlug))
  }
  if (options.emotionTags?.length) {
    conditions.push({ emotionTag: { in: options.emotionTags as EmotionTag[] } })
  }
  if (options.publishedSince || options.publishedBefore) {
    conditions.push({
      datePublished: {
        ...(options.publishedSince && { gte: options.publishedSince }),
        ...(options.publishedBefore && { lt: options.publishedBefore }),
      },
    })
  }
  if (options.minRelevance !== undefined) {
    conditions.push({ relevance: { gte: options.minRelevance } })
  }

  const orderBy: Prisma.StoryOrderByWithRelationInput[] = [{ datePublished: 'desc' }, { dateCrawled: 'desc' }]

  const where: Prisma.StoryWhereInput = {
    status: 'published',
    ...(conditions.length > 0 && { AND: conditions }),
  }

  return paginate({
    findMany: () =>
      prisma.story.findMany({
        where,
        select: PUBLIC_STORY_SELECT,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    count: () => prisma.story.count({ where }),
    page,
    pageSize,
  })
}

export async function getPublishedStoryBySlug(slug: string) {
  return prisma.story.findFirst({
    where: { slug, status: 'published' },
    select: PUBLIC_STORY_SELECT,
  })
}

/**
 * If a story with this slug is a non-primary cluster member (e.g. rejected after clustering),
 * return the primary story's slug for redirect purposes.
 */
export async function getClusterRedirectSlug(slug: string): Promise<string | null> {
  const story = await prisma.story.findFirst({
    where: { slug, clusterId: { not: null } },
    select: {
      id: true,
      cluster: {
        select: {
          primaryStoryId: true,
          primaryStory: { select: { slug: true, status: true } },
        },
      },
    },
  })

  if (!story?.cluster?.primaryStory) return null
  // Only redirect if this story is NOT the primary and the primary is published
  if (story.id === story.cluster.primaryStoryId) return null
  if (story.cluster.primaryStory.status !== 'published') return null
  if (!story.cluster.primaryStory.slug) return null

  return story.cluster.primaryStory.slug
}

export async function getClusterMembers(slug: string): Promise<{
  sources: { feedTitle: string; sourceUrl: string }[]
} | null> {
  const story = await prisma.story.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, clusterId: true },
  })

  if (!story?.clusterId) return null

  const clusterStories = await prisma.story.findMany({
    where: {
      clusterId: story.clusterId,
      id: { not: story.id },
      title: { not: null },
      summary: { not: null },
      status: { in: ['analyzed', 'selected', 'published', 'rejected'] },
    },
    select: {
      sourceUrl: true,
      feed: { select: { displayTitle: true, title: true } },
    },
    orderBy: { dateCrawled: 'asc' },
  })

  if (clusterStories.length === 0) return null

  return {
    sources: clusterStories.map(s => ({
      feedTitle: s.feed.displayTitle || s.feed.title,
      sourceUrl: s.sourceUrl,
    })),
  }
}

const NEGATIVE_EMOTIONS: EmotionTag[] = [EmotionTag.frustrating, EmotionTag.scary]

/**
 * Get all data needed for the homepage.
 * Returns stories grouped by issue slug in three emotion buckets:
 * uplifting, calm, and negative (frustrating + scary).
 * Hero is picked client-side from these buckets — no separate queries needed.
 */
export async function getHomepageData(issueSlugs: string[], storiesPerIssue = 7) {
  const orderBy: Prisma.StoryOrderByWithRelationInput[] = [{ datePublished: 'desc' }, { dateCrawled: 'desc' }]

  // Fetch three emotion buckets per issue for client-side mixing.
  // Three buckets allow the client to show uplifting-only at 100% positivity
  // while combining uplifting+calm as "positive" for all other settings.
  const storiesPromises = issueSlugs.map(async slug => {
    const baseWhere: Prisma.StoryWhereInput = { status: 'published', ...storyInIssueWhere(slug) }

    const [uplifting, calm, negative] = await Promise.all([
      prisma.story.findMany({
        where: { ...baseWhere, emotionTag: EmotionTag.uplifting },
        select: PUBLIC_STORY_SELECT,
        orderBy,
        take: storiesPerIssue,
      }),
      prisma.story.findMany({
        where: { ...baseWhere, emotionTag: EmotionTag.calm },
        select: PUBLIC_STORY_SELECT,
        orderBy,
        take: storiesPerIssue,
      }),
      prisma.story.findMany({
        where: { ...baseWhere, emotionTag: { in: NEGATIVE_EMOTIONS } },
        select: PUBLIC_STORY_SELECT,
        orderBy,
        take: storiesPerIssue,
      }),
    ])

    return { slug, uplifting, calm, negative }
  })

  const issueResults = await Promise.all(storiesPromises)

  const storiesByIssue: Record<string, Omit<(typeof issueResults)[number], 'slug'>> = {}
  for (const { slug, uplifting, calm, negative } of issueResults) {
    storiesByIssue[slug] = { uplifting, calm, negative }
  }

  return { storiesByIssue }
}
