/**
 * The overview upkeep's model calls as the evals make them (`stands`, `closure`, `review`, `replay`):
 * production's prompts and schemas on the eval's cached calls, each step on its tier's arm
 * (`TIER_ARMS`), the monthly audit at high effort, run k ≥ 2 under its own cache key.
 */
import { config } from '../../../config.js'
import { buildCloseCheckPrompt, buildClosePrompt, buildReviewPrompt, buildStandsPromptParts } from '../../../prompts/overviews.js'
import { buildFactCheckPromptParts } from '../../../prompts/research.js'
import { closeCheckSchema, closeSchema, reviewSchema, standsSchema } from '../../../schemas/overviews.js'
import { factCheckSchema } from '../../../schemas/research.js'
import type { CloseDeps } from '../../../services/overviewClose.js'
import type { ReviewDeps } from '../../../services/overviewReview.js'
import type { StandsDeps } from '../../../services/overviewStands.js'
import { versionedSchemaName } from '../models.js'
import type { SuiteContext } from '../types.js'
import { evalCall, TIER_ARMS } from './link.js'

const { tiers } = config.overviews

export const UPKEEP_ARMS = {
  stands: TIER_ARMS[tiers.stands],
  standsCheck: TIER_ARMS[tiers.standsCheck],
  close: TIER_ARMS[tiers.close],
  closeCheck: TIER_ARMS[tiers.closeCheck],
  review: TIER_ARMS[tiers.review],
  audit: { ...TIER_ARMS[tiers.review], effort: 'high' as const },
}

const NAMES = {
  stands: versionedSchemaName('overview-stands', standsSchema),
  standsCheck: versionedSchemaName('overview-stands-check', factCheckSchema),
  close: versionedSchemaName('overview-close', closeSchema),
  closeCheck: versionedSchemaName('overview-close-check', closeCheckSchema),
  review: versionedSchemaName('overview-review', reviewSchema),
}

export interface UpkeepCalls {
  close: CloseDeps
  review: ReviewDeps
  stands: StandsDeps
}

export function upkeepCalls(ctx: SuiteContext, run: number): UpkeepCalls {
  return {
    close: {
      close: input => evalCall(ctx, UPKEEP_ARMS.close, NAMES.close, closeSchema, buildClosePrompt(input), run),
      closeCheck: input => evalCall(ctx, UPKEEP_ARMS.closeCheck, NAMES.closeCheck, closeCheckSchema, buildCloseCheckPrompt(input), run),
    },
    review: {
      review: (input, { audit }) => evalCall(ctx, audit ? UPKEEP_ARMS.audit : UPKEEP_ARMS.review, NAMES.review, reviewSchema, buildReviewPrompt(input), run),
    },
    stands: {
      write: input => evalCall(ctx, UPKEEP_ARMS.stands, NAMES.stands, standsSchema, buildStandsPromptParts(input), run),
      check: (items, lines) => evalCall(ctx, UPKEEP_ARMS.standsCheck, NAMES.standsCheck, factCheckSchema, buildFactCheckPromptParts(items, lines, []), run),
    },
  }
}
