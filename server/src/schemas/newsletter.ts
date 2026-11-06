import { z } from 'zod'

const editionSchema = z.enum(['full', 'uplifting'])

export const createNewsletterSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  edition: editionSchema.optional(),
})

export const updateNewsletterSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  html: z.string().optional(),
  storyIds: z.array(z.string().uuid()).optional(),
  selectedStoryIds: z.array(z.string().uuid()).optional(),
  status: z.enum(['draft', 'published']).optional(),
})

export const sendLiveSchema = z.object({
  scheduledFor: z.string().datetime().optional(),
})

export const newsletterQuerySchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  edition: editionSchema.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})

/** `GET /api/newsletters`: the public archive of published issues, of both editions or one. */
export const publicNewsletterQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  edition: editionSchema.optional(),
})
