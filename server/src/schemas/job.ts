import { z } from 'zod'

/** A chain's flex cut-off or deadline: hours from the start of each run, in quarter hours up to 48, or null for none. */
const hoursFromStart = z
  .number()
  .positive('Must be more than 0 hours')
  .max(48, 'Must be at most 48 hours')
  .multipleOf(0.25, 'Must be in quarter hours, such as 4.5')
  .nullable()

export const updateJobSchema = z.object({
  cronExpression: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  /** Model calls at OpenAI's flex price, falling back to standard. */
  flex: z.boolean().optional(),
  /** A chain's step: the chain waits for a person after it. */
  pauseForReview: z.boolean().optional(),
  /** A chain's step: the chain holds before it until this time ("HH:MM" or "Sat 07:00") comes round after the run's start. */
  notBefore: z
    .string()
    .regex(/^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM, or a weekday and HH:MM such as "Sat 07:00"')
    .nullable()
    .optional(),
  /** A chain: calls go at standard price once this many hours have passed since the run started. */
  flexHours: hoursFromStart.optional(),
  /** A chain: a step working through items starts no new one once this many hours have passed since the run started. */
  deadlineHours: hoursFromStart.optional(),
})

export const crawlUrlSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  feedId: z.string().uuid('Must be a valid feed ID'),
})
