import { z } from 'zod'

/** A chain's flex cut-off or deadline: "HH:MM" UTC, or null for none (jobs/chainDefinitions.ts). */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time of day as HH:MM (UTC)')
  .nullable()

export const updateJobSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  /** Model calls at OpenAI's flex price, falling back to standard. */
  flex: z.boolean().optional(),
  /** A chain's step: the chain waits for a person after it. */
  pauseForReview: z.boolean().optional(),
  /** A chain: calls go at standard price from this time on. */
  flexUntil: clockTime.optional(),
  /** A chain: a step working through items starts no new one from this time on. */
  deadline: clockTime.optional(),
})

export const crawlUrlSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  feedId: z.string().uuid('Must be a valid feed ID'),
})
