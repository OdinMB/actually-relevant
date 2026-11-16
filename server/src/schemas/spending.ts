import { z } from 'zod'

/** A spending warning level (services/spending.ts): whole US dollars, at least 1, or null to clear it. */
export const spendWarningSchema = z.object({
  levelUsd: z.number().int('Must be a whole number of dollars').min(1, 'Must be at least $1').max(1_000_000).nullable(),
})
