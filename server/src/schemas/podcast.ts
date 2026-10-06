import { z } from 'zod'

const STAGES = ['legacy', 'created', 'selected', 'scripted', 'voiced', 'ready'] as const

/** The title and the "edited by a person" flag; stage and status change through the pipeline and publishing. */
export const updatePodcastSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200).optional(),
  humanEdited: z.boolean().optional(),
}).strict().refine(body => body.title !== undefined || body.humanEdited !== undefined, { message: 'Nothing to update' })

/** Start, approve, continue or "finish automatically"; a given mode is stored first. */
export const resumePodcastSchema = z.object({
  mode: z.enum(['automated', 'interactive']).optional(),
}).strict().default({})

/** Go back to an earlier stage; `advance` continues from there in the background. */
export const rewindPodcastSchema = z.object({
  to: z.enum(['created', 'selected', 'scripted']),
  advance: z.boolean(),
}).strict()

/** The episode's stories in episode order (count and pool membership are checked by the service). */
export const podcastStoriesSchema = z.object({
  storyIds: z.array(z.string().min(1)).min(1).max(20),
}).strict()

/** A person's script edit: the stored structure echoed back with new turn text and summary. */
export const podcastScriptEditSchema = z.object({
  episodeSummary: z.string().max(2000),
  segments: z.array(z.object({
    kind: z.enum(['intro', 'story', 'outro']),
    storyRef: z.number().int().nullable(),
    turns: z.array(z.object({
      speaker: z.enum(['HOST_A', 'HOST_B']),
      text: z.string().max(2000),
    }).strict()).max(50),
  }).strict()).max(20),
}).strict()

export const podcastQuerySchema = z.object({
  status: z.enum(['draft', 'published']).optional(),
  stage: z.enum(STAGES).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})
