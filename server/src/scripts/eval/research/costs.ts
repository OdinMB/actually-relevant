/**
 * What the research costs: per-step and per-story sums of the call records, the projection to a
 * month of 250 researched stories (credits inside and above Tavily's free 1,000), and the
 * design's desk estimate priced with the eval's price table (`costOf`). Pure.
 */
import { queryCount } from '../../../prompts/research.js'
import { costOf } from '../models.js'
import type { CallOutcome, TokenUsage } from '../types.js'
import { STEP_ARMS, STEP_ESTIMATES, STEPS, type StepName, type StoryResearch } from './pipeline.js'
import { CREDITS_PER_SEARCH, TAVILY_DEPTH, TAVILY_FREE_CREDITS_PER_MONTH, TAVILY_USD_PER_CREDIT } from './tavily.js'

/** Selected stories a month that research would run on (design: ~150-330; its estimate uses 250). */
export const MONTHLY_STORIES = 250

export interface CostLine {
  calls: number
  outcomes: Partial<Record<CallOutcome, number>>
  usage: TokenUsage
  usd: number
}

export interface CostSummary {
  stories: number
  perStep: Record<StepName, CostLine>
  perStory: { storyId: string; cost: CostLine; credits: number }[]
  total: CostLine
  credits: number
}

const emptyLine = (): CostLine => ({ calls: 0, outcomes: {}, usage: { input: 0, cached: 0, output: 0, reasoning: 0 }, usd: 0 })

function add(line: CostLine, c: { outcome: CallOutcome; usage: TokenUsage; costUsd: number }): void {
  line.calls++
  line.outcomes[c.outcome] = (line.outcomes[c.outcome] ?? 0) + 1
  line.usage.input += c.usage.input
  line.usage.cached += c.usage.cached
  line.usage.output += c.usage.output
  line.usage.reasoning += c.usage.reasoning
  line.usd += c.costUsd
}

/** Cached calls count at what they cost when made: the measurement is what a story's research costs. */
export function summarizeCosts(results: StoryResearch[]): CostSummary {
  const perStep = Object.fromEntries(STEPS.map(s => [s, emptyLine()])) as Record<StepName, CostLine>
  const total = emptyLine()
  const perStory = results.map(r => {
    const cost = emptyLine()
    for (const c of r.calls) {
      add(cost, c)
      add(perStep[c.step], c)
      add(total, c)
    }
    return { storyId: r.storyId, cost, credits: r.credits }
  })
  return { stories: results.length, perStep, perStory, total, credits: results.reduce((n, r) => n + r.credits, 0) }
}

export interface MonthlyProjection {
  stories: number
  modelUsd: number
  credits: number
  freeCredits: number
  paidCredits: number
  tavilyUsd: number
  totalUsd: number
}

/** The measured mean per story, times a month's stories; credits beyond the free tier at the pay-as-you-go price. */
export function projectMonthly(summary: CostSummary, stories: number = MONTHLY_STORIES): MonthlyProjection {
  const n = summary.stories
  const modelUsd = n === 0 ? 0 : (summary.total.usd / n) * stories
  const credits = n === 0 ? 0 : Math.round((summary.credits / n) * stories)
  const freeCredits = Math.min(credits, TAVILY_FREE_CREDITS_PER_MONTH)
  const paidCredits = credits - freeCredits
  const tavilyUsd = paidCredits * TAVILY_USD_PER_CREDIT
  return { stories, modelUsd, credits, freeCredits, paidCredits, tavilyUsd, totalUsd: modelUsd + tavilyUsd }
}

/** One step's desk estimate per story, in USD. */
export function deskEstimateUsd(step: StepName): number {
  const e = STEP_ESTIMATES[step]
  return costOf(STEP_ARMS[step].model, { input: e.input, cached: 0, output: e.output, reasoning: 0 })
}

/** Credits a story's searches are expected to cost: one search per query at the configured depth. */
export const expectedCredits = (language: string): number => queryCount(language) * CREDITS_PER_SEARCH[TAVILY_DEPTH]

/**
 * What one story may cost before the run starts it: every step's estimate (the confirmation and a
 * rewrite included, so the run stops before it would overrun) plus its expected credits.
 */
export function storyBudgetUsd(language: string): number {
  return STEPS.reduce((sum, s) => sum + deskEstimateUsd(s), 0) + expectedCredits(language) * TAVILY_USD_PER_CREDIT
}
