/**
 * The overview step's model calls, declared once (`.context/overviews.md`, "The job"): each call's
 * tier, its own reasoning effort where it has one, its schema and its prompt, and the name the evals'
 * cache files it under. Production makes the calls with `structuredCall` (the job's production deps),
 * the evals on their cached calls (`link.ts`, `upkeepCalls.ts`); both through `overviewCalls`, so a
 * tier, a schema or a prompt changes for both at once. Pure: no client of its own.
 */
import type { z } from 'zod'
import { config, type ReasoningEffort } from '../config.js'
import type { Prompt } from '../lib/promptCache.js'
import {
  buildCloseCheckPrompt,
  buildClosePrompt,
  buildFoundCheckPrompt,
  buildFoundPrompt,
  buildLinkPromptParts,
  buildReviewPrompt,
  buildStandsPromptParts,
} from '../prompts/overviews.js'
import { buildFactCheckPromptParts } from '../prompts/research.js'
import { closeCheckSchema, closeSchema, foundCheckSchema, foundSchema, linkSchema, reviewSchema, standsSchema } from '../schemas/overviews.js'
import { factCheckSchema } from '../schemas/research.js'
import type { CloseDeps } from './overviewClose.js'
import type { LinkDeps, ModelCall } from './overviewLink.js'
import type { ReviewDeps } from './overviewReview.js'
import type { StandsDeps } from './overviewStands.js'
import type { ModelTier } from './structuredCall.js'

/** One model call of the step: its tier and effort, and the schema its answer is parsed with. */
export interface OverviewStep<T> {
  /** The evals' cache name for it (versioned there by the schema). */
  name: string
  tier: ModelTier
  /** Its own reasoning effort, instead of its tier's. */
  effort?: ReasoningEffort
  schema: z.ZodType<T>
}

const step = <T>(name: string, tier: ModelTier, schema: z.ZodType<T>, effort?: ReasoningEffort): OverviewStep<T> => ({
  name,
  tier,
  schema,
  ...(effort ? { effort } : {}),
})

const { tiers } = config.overviews

export const OVERVIEW_STEPS = {
  link: step('overview-link', tiers.link, linkSchema),
  found: step('overview-found', tiers.found, foundSchema),
  foundCheck: step('overview-found-check', tiers.foundCheck, foundCheckSchema),
  close: step('overview-close', tiers.close, closeSchema),
  closeCheck: step('overview-close-check', tiers.closeCheck, closeCheckSchema),
  review: step('overview-review', tiers.review, reviewSchema),
  /** The monthly audit: the review's call at high effort. */
  audit: step('overview-review', tiers.review, reviewSchema, 'high'),
  stands: step('overview-stands', tiers.stands, standsSchema),
  standsCheck: step('overview-stands-check', tiers.standsCheck, factCheckSchema),
}

/** How a caller makes one step's call with its prompt: production's `structuredCall`, an eval's cached call. */
export type StepCaller = <T>(step: OverviewStep<T>, prompt: Prompt) => Promise<ModelCall<T>>

export interface OverviewCalls {
  link: Pick<LinkDeps, 'link' | 'found' | 'foundCheck'>
  close: CloseDeps
  review: ReviewDeps
  stands: StandsDeps
}

/** Every model call of linking and the upkeep, each with its step's prompt, made by `call`. */
export function overviewCalls(call: StepCaller): OverviewCalls {
  const s = OVERVIEW_STEPS
  return {
    link: {
      link: input => call(s.link, buildLinkPromptParts(input)),
      found: input => call(s.found, buildFoundPrompt(input)),
      foundCheck: input => call(s.foundCheck, buildFoundCheckPrompt(input)),
    },
    close: {
      close: input => call(s.close, buildClosePrompt(input)),
      closeCheck: input => call(s.closeCheck, buildCloseCheckPrompt(input)),
    },
    review: { review: (input, { audit }) => call(audit ? s.audit : s.review, buildReviewPrompt(input)) },
    stands: {
      write: input => call(s.stands, buildStandsPromptParts(input)),
      check: (items, lines) => call(s.standsCheck, buildFactCheckPromptParts(items, lines, [])),
    },
  }
}
