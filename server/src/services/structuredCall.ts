/**
 * One structured-output call on a tier's model, as research's and story context's steps make it:
 * after the shared rate-limit delay, never wrapped in `withRetry` (the SDK's `maxRetries` already
 * retries, `.context/llm-analysis.md`, "Retries"), its prompt sent as `promptMessage` sends it (a split
 * prompt with its cache breakpoint), its usage read from the answer and priced at research's prices
 * (`callCostUsd`), and its outcome classified; an answer the outcome rejects keeps its cost but not
 * its value. A step may ask for its own reasoning effort (`researchEffort.ts`). A thrown error is an
 * `error` outcome with no usage, and the error itself for the caller to judge (a budget, a second attempt).
 */
import type { AIMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import { config, type ReasoningEffort } from '../config.js'
import { classifyOutcome, contentText, finishReasonOf, usageFrom, ZERO_USAGE, type LlmCallOutcome, type LlmTokenUsage } from '../lib/llmUsage.js'
import { promptMessage, type Prompt } from '../lib/promptCache.js'
import { getLLMAtEffort, getLLMByTier, rateLimitDelay } from './llm.js'
import { callCostUsd } from './researchCost.js'

export type ModelTier = 'small' | 'medium' | 'large'

export interface StructuredCallResult<T> {
  parsed: T | null
  outcome: LlmCallOutcome
  usage: LlmTokenUsage
  costUsd: number
  model: string
  /** What the call threw, with an `error` outcome. */
  error?: unknown
}

export interface StructuredCallOptions {
  /** The step's own reasoning effort, instead of its tier's. */
  effort?: ReasoningEffort
}

export async function structuredCall<T>(
  tier: ModelTier,
  schema: z.ZodType<T>,
  prompt: Prompt,
  options: StructuredCallOptions = {},
): Promise<StructuredCallResult<T>> {
  const model = config.llm.models[tier].name
  await rateLimitDelay()
  try {
    const llm = options.effort ? getLLMAtEffort(tier, options.effort) : getLLMByTier(tier)
    const result = await llm.withStructuredOutput(schema, { includeRaw: true }).invoke([promptMessage(prompt, model)])
    const raw = result.raw as AIMessage
    // The schema parsed it: the structured-output runnable types its result loosely
    const parsed = (result.parsed ?? null) as T | null
    const usage = usageFrom(raw)
    const outcome = classifyOutcome({ parsed, content: contentText(raw), finishReason: finishReasonOf(raw) })
    return { parsed: outcome === 'ok' ? parsed : null, outcome, usage, costUsd: callCostUsd(model, usage), model }
  } catch (error) {
    return { parsed: null, outcome: classifyOutcome({ error }), usage: ZERO_USAGE, costUsd: 0, model, error }
  }
}
