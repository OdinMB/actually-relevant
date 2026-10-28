import { z } from 'zod'

const storyStatusEnum = z.enum(['fetched', 'pre_analyzed', 'analyzed', 'selected', 'published', 'rejected', 'trashed'])

const emotionTagEnum = z.enum(['uplifting', 'frustrating', 'scary', 'calm'])

const storySortEnum = z.enum(['rating_asc', 'rating_desc', 'date_asc', 'date_desc', 'title_asc', 'title_desc'])

const ratingFilterEnum = z.enum(['gte4', 'gte5', 'gte6', 'gte7', 'lte3', 'lte4', 'lte5', 'lte6', 'lte7'])

export const createStorySchema = z.object({
  sourceUrl: z.string().url('Must be a valid URL'),
  sourceTitle: z.string().min(1, 'Source title is required'),
  sourceContent: z.string().min(1, 'Source content is required'),
  feedId: z.string().uuid('Must be a valid feed ID'),
  sourceDatePublished: z.string().datetime().optional(),
})

export const updateStorySchema = z.object({
  sourceUrl: z.string().url().optional(),
  sourceTitle: z.string().min(1).optional(),
  sourceContent: z.string().optional(),
  sourceDatePublished: z.string().datetime().nullable().optional(),
  title: z.string().min(1).nullable().optional(),
  titleLabel: z.string().min(1).nullable().optional(),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens')
    .optional(),
  issueId: z.string().uuid().nullable().optional(),
  status: storyStatusEnum.optional(),
  relevancePre: z.number().int().min(0).max(10).nullable().optional(),
  relevance: z.number().int().min(0).max(10).nullable().optional(),
  emotionTag: emotionTagEnum.nullable().optional(),
  summary: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
  quoteAttribution: z.string().nullable().optional(),
  marketingBlurb: z.string().nullable().optional(),
  relevanceReasons: z.string().nullable().optional(),
  relevanceSummary: z.string().nullable().optional(),
  antifactors: z.string().nullable().optional(),
  relevanceCalculation: z.string().nullable().optional(),
})

export const updateStoryStatusSchema = z.object({
  status: storyStatusEnum,
})

export const bulkUpdateStatusSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required').max(500, 'Maximum 500 story IDs allowed'),
  status: storyStatusEnum,
})

export const storyQuerySchema = z.object({
  status: z.union([storyStatusEnum, z.literal('all')]).optional(),
  issueId: z.string().uuid().optional(),
  feedId: z.string().uuid().optional(),
  crawledAfter: z.string().datetime().optional(),
  crawledBefore: z.string().datetime().optional(),
  ratingMin: z.coerce.number().int().min(0).max(10).optional(),
  ratingMax: z.coerce.number().int().min(0).max(10).optional(),
  rating: ratingFilterEnum.optional(),
  emotionTag: emotionTagEnum.optional(),
  accessTier: z.enum(['locked', 'metered']).optional(),
  search: z.string().max(200).optional(),
  sort: storySortEnum.optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().positive().max(100).optional().default(25),
})

export const preassessBodySchema = z.object({
  storyIds: z.array(z.string().uuid()).optional(),
})

export const selectBodySchema = z.object({
  storyIds: z.array(z.string().uuid()).min(1, 'At least one story ID is required'),
})

export const batchStoriesQuerySchema = z.object({
  ids: z
    .string()
    .min(1, 'At least one ID is required')
    .transform(str =>
      str
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    )
    .refine(arr => arr.length <= 100, { message: 'Maximum 100 IDs allowed' })
    .refine(arr => arr.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)), { message: 'All IDs must be valid UUIDs' }),
})

export const bulkStoryIdsSchema = z.object({
  storyIds: z.array(z.string().uuid()).min(1, 'At least one story ID is required').max(500, 'Maximum 500 story IDs allowed'),
})

export const bulkSelectIdsSchema = z.object({
  storyIds: z.array(z.string().uuid()).min(2, 'At least 2 story IDs are required for selection').max(500, 'Maximum 500 story IDs allowed'),
})

// Incremental-sync filters of the public API and RSS feeds. Their names are part of the
// public API contract (documented in lib/openapi.ts and on /free-api), so never rename them.
const ISO_DATE_TIME_MESSAGE = 'Must be an ISO 8601 date-time with a time zone, e.g. 2026-10-01T00:00:00Z'

export const publishedSinceParam = z.string().datetime({ offset: true, message: ISO_DATE_TIME_MESSAGE })
export const publishedBeforeParam = z.string().datetime({ offset: true, message: ISO_DATE_TIME_MESSAGE })
export const minRelevanceParam = z.coerce
  .number({ invalid_type_error: 'Must be a whole number from 1 to 10' })
  .int('Must be a whole number from 1 to 10')
  .min(1, 'Must be a whole number from 1 to 10')
  .max(10, 'Must be a whole number from 1 to 10')

/** `GET /api/stories/:slug/related`: how many related stories to return (default `relatedStories.displayCount`). */
export const relatedStoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).optional(),
})

export const publicStoryQuerySchema = z
  .object({
    issueSlug: z.string().optional(),
    search: z.string().min(2).max(200).optional(),
    emotionTags: z.string().optional(),
    publishedSince: publishedSinceParam.optional(),
    publishedBefore: publishedBeforeParam.optional(),
    minRelevance: minRelevanceParam.optional(),
    page: z.coerce.number().int().positive().optional().default(1),
    pageSize: z.coerce.number().int().positive().max(100).optional().default(25),
  })
  .refine(q => !q.publishedSince || !q.publishedBefore || Date.parse(q.publishedSince) < Date.parse(q.publishedBefore), {
    message: 'publishedSince must be earlier than publishedBefore',
    path: ['publishedBefore'],
  })
  .refine(q => !q.search || (q.publishedSince === undefined && q.publishedBefore === undefined && q.minRelevance === undefined), {
    message: 'publishedSince, publishedBefore and minRelevance cannot be combined with search',
    path: ['search'],
  })

/** Query of the public RSS feeds: only the relevance floor (a feed reader polls one fixed URL). */
export const feedQuerySchema = z.object({
  minRelevance: minRelevanceParam.optional(),
})
