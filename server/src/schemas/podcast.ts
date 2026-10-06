import { z } from 'zod'

/** Only the title is edited by hand; stage and status change through the pipeline and publishing. */
export const updatePodcastSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
}).strict()

export const podcastQuerySchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  stage: z.enum(['legacy', 'created', 'scripted', 'voiced', 'ready']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})
