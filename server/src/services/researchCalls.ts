/**
 * Production's step caller and Tavily wrapper for one research run or research pass
 * (`.context/story-research.md`, "Cap"; `.context/research-passes.md`, "Budget"): one metered
 * structured-output call per step on the step's tier model (`structuredCall`: after the shared
 * rate-limit delay, never wrapped in `withRetry`, as `.context/llm-analysis.md`, "Retries", says),
 * the extraction steps at `config.research.extractionEffort` (`passStepEffort`).
 * The meter adds each call's model cost and each search's credits, a pass's card steps and gap
 * searches included. Before every call, search and parallel batch it checks the estimate against the
 * room left: the run's own ceiling, and what the month's cap leaves; a call without room is `skipped`
 * and a search without room throws `BudgetExhaustedError`, so the run ends as `fallback: budget`.
 */
import type { z } from 'zod'
import { config } from '../config.js'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { promptText, takesCacheControls, type Prompt } from '../lib/promptCache.js'
import { CREDITS_PER_SEARCH, searchTavily, TAVILY_DEPTH, type TavilySearch } from '../lib/tavily.js'
import { callCostUsd } from './researchCost.js'
import { PASS_STEP_TIERS, passStepEffort, type PassCall, type PassStep } from './researchPassSteps.js'
import { BudgetExhaustedError, type PlannedStep, type ResearchSearchAnswer, type StepResult } from './researchPipeline.js'
import type { ContextSearchAnswer, ContextSearchRequest } from './storyContextSources.js'
import { structuredCall } from './structuredCall.js'

/** Output tokens one call of each step is expected to bill, reasoning included (the design's desk estimate, per call). */
const STEP_OUTPUT_TOKENS: Record<PassStep, number> = {
  confirm: 500,
  queries: 500,
  extract: 2000,
  earlier: 500,
  write: 4500,
  'fact-check': 1000,
  // A repair round now; still sized for a whole draft, so it reserves more than one needs
  rewrite: 5500,
  derive: 1500,
  // A research pass's card steps (story context's, at its desk estimate)
  structure: 1500,
  'gap-list': 1000,
  'gap-extract': 2000,
  'facts-check': 1500,
  'cards-write': 3000,
  'box-check': 1500,
  // A later pass's judge (a verdict per section), its rewrite of the flagged sections, and the Update note
  judge: 1500,
  update: 3000,
  note: 400,
}

const HAN = /\p{Script=Han}/gu

/** Rough input-token estimate: Han characters ≈ 1 token each, other text ≈ 4 characters a token. */
function inputTokens(text: string): number {
  const han = text.match(HAN)?.length ?? 0
  return Math.ceil(han + (text.length - han) / 4)
}

const modelOf = (step: PassStep) => config.llm.models[PASS_STEP_TIERS[step]].name

/** A call's cost before it is made: a cached prompt's stable part counted as a cache write, the dearer outcome. */
function estimateUsd(p: { step: PassStep; prompt: Prompt }): number {
  const model = modelOf(p.step)
  const cacheWrite = typeof p.prompt !== 'string' && takesCacheControls(model) ? inputTokens(p.prompt.stable) : 0
  return callCostUsd(model, { input: inputTokens(promptText(p.prompt)), cached: 0, cacheWrite, output: STEP_OUTPUT_TOKENS[p.step], reasoning: 0 })
}

export interface RunMeterOptions {
  /** The run's or pass's ceiling (`config.research.maxRunUsd`, `research.pass.firstPassUsd`), which its reservation holds against the cap. */
  ceilingUsd: number
  /** What the month's cap leaves for this run now: the cap minus every other run's spend this month. */
  monthRoomUsd: () => Promise<number>
  /** A pass's gap search (story context's, with its cache and opt-out check); a research run makes none. */
  gapSearch?: (request: ContextSearchRequest) => Promise<ContextSearchAnswer>
  /** A pass's judgment of a failed call's error: whether it may pass on a second attempt (`transientFailure`). */
  transient?: (err: unknown) => boolean
}

export interface RunMeter {
  call: PassCall
  tavily: { search(request: TavilySearch): Promise<ResearchSearchAnswer> }
  /** A pass's gap search, metered: a cached answer costs nothing. */
  search(request: ContextSearchRequest): Promise<ContextSearchAnswer>
  /** Whether a batch of parallel calls may start: its whole estimate must fit the room left. */
  admit(batch: PlannedStep[]): Promise<boolean>
  /** Model cost plus Tavily credits so far. */
  spentUsd(): number
}

export function createRunMeter(options: RunMeterOptions): RunMeter {
  let spent = 0

  async function fits(estimateUsd: number): Promise<boolean> {
    const room = Math.min(options.ceilingUsd, await options.monthRoomUsd())
    return spent + estimateUsd <= room
  }

  const call: PassCall = async <T>(step: PassStep, schema: z.ZodType<T>, prompt: Prompt) => {
    if (!(await fits(estimateUsd({ step, prompt })))) return { parsed: null, outcome: 'skipped', usage: ZERO_USAGE, costUsd: 0, model: modelOf(step) }
    const effort = passStepEffort(step)
    const { error, ...result }: { error?: unknown } & StepResult<T> = await structuredCall(PASS_STEP_TIERS[step], schema, prompt, effort ? { effort } : {})
    spent += result.costUsd
    return result.outcome === 'error' && options.transient ? { ...result, transient: options.transient(error) } : result
  }

  return {
    call,
    tavily: {
      async search(request) {
        if (!(await fits(CREDITS_PER_SEARCH[TAVILY_DEPTH] * config.research.tavilyUsdPerCredit))) throw new BudgetExhaustedError()
        const answer = await searchTavily(request, config.research.tavilyApiKey)
        spent += answer.credits * config.research.tavilyUsdPerCredit
        return answer
      },
    },
    async search(request) {
      if (!options.gapSearch) throw new Error('this run makes no gap searches')
      if (!(await fits(CREDITS_PER_SEARCH[config.storyContext.searchDepth] * config.research.tavilyUsdPerCredit))) throw new BudgetExhaustedError()
      const answer = await options.gapSearch(request)
      spent += answer.credits * config.research.tavilyUsdPerCredit
      return answer
    },
    admit: async batch => fits(batch.reduce((sum, p) => sum + estimateUsd(p), 0)),
    spentUsd: () => spent,
  }
}
