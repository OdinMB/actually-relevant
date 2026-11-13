/**
 * Production's step caller and Tavily wrapper for one research run (`.context/story-research.md`,
 * "Cap"): one metered structured-output call per step on the step's tier model, after the shared
 * rate-limit delay, and never wrapped in `withRetry` (the SDK's `maxRetries` already retries,
 * `.context/llm-analysis.md`, "Retries"). The meter adds each call's model cost and each search's
 * credits. Before every call, search and parallel batch it checks the estimate against the room
 * left: the run's own ceiling, and what the month's cap leaves; a call without room is `skipped`
 * and a search without room throws `BudgetExhaustedError`, so the run ends as `fallback: budget`.
 */
import { HumanMessage, type AIMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import { config } from '../config.js'
import { classifyOutcome, contentText, finishReasonOf, usageFrom, ZERO_USAGE } from '../lib/llmUsage.js'
import { CREDITS_PER_SEARCH, searchTavily, TAVILY_DEPTH, type TavilySearch } from '../lib/tavily.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { callCostUsd } from './researchCost.js'
import {
  BudgetExhaustedError,
  STEP_TIERS,
  type PlannedStep,
  type ResearchCall,
  type ResearchSearchAnswer,
  type StepName,
  type StepResult,
} from './researchPipeline.js'

/** Output tokens one call of each step is expected to bill, reasoning included (the design's desk estimate, per call). */
const STEP_OUTPUT_TOKENS: Record<StepName, number> = {
  confirm: 500,
  queries: 500,
  extract: 2000,
  earlier: 500,
  write: 4500,
  'fact-check': 1000,
  // A repair round now; still sized for a whole draft, so it reserves more than one needs
  rewrite: 5500,
  derive: 1500,
}

const HAN = /\p{Script=Han}/gu

/** Rough input-token estimate: Han characters ≈ 1 token each, other text ≈ 4 characters a token. */
function inputTokens(text: string): number {
  const han = text.match(HAN)?.length ?? 0
  return Math.ceil(han + (text.length - han) / 4)
}

const modelOf = (step: StepName) => config.llm.models[STEP_TIERS[step]].name

function estimateUsd(p: PlannedStep): number {
  return callCostUsd(modelOf(p.step), { input: inputTokens(p.prompt), cached: 0, output: STEP_OUTPUT_TOKENS[p.step], reasoning: 0 })
}

export interface RunMeterOptions {
  /** The run's ceiling (`config.research.maxRunUsd`), which its reservation holds against the cap. */
  ceilingUsd: number
  /** What the month's cap leaves for this run now: the cap minus every other run's spend this month. */
  monthRoomUsd: () => Promise<number>
}

export interface RunMeter {
  call: ResearchCall
  tavily: { search(request: TavilySearch): Promise<ResearchSearchAnswer> }
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

  const call: ResearchCall = async <T>(step: StepName, schema: z.ZodType<T>, prompt: string): Promise<StepResult<T>> => {
    const model = modelOf(step)
    const nothing = { parsed: null, usage: ZERO_USAGE, costUsd: 0, model }
    if (!(await fits(estimateUsd({ step, prompt })))) return { ...nothing, outcome: 'skipped' }
    await rateLimitDelay()
    try {
      const result = await getLLMByTier(STEP_TIERS[step])
        .withStructuredOutput(schema, { includeRaw: true })
        .invoke([new HumanMessage(prompt)])
      const raw = result.raw as AIMessage
      // The schema parsed it: the structured-output runnable types its result loosely
      const parsed = (result.parsed ?? null) as T | null
      const usage = usageFrom(raw)
      const costUsd = callCostUsd(model, usage)
      spent += costUsd
      const outcome = classifyOutcome({ parsed, content: contentText(raw), finishReason: finishReasonOf(raw) })
      return { parsed: outcome === 'ok' ? parsed : null, outcome, usage, costUsd, model }
    } catch (err) {
      return { ...nothing, outcome: classifyOutcome({ error: err }) }
    }
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
    admit: async batch => fits(batch.reduce((sum, p) => sum + estimateUsd(p), 0)),
    spentUsd: () => spent,
  }
}
