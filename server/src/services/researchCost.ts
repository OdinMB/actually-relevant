/**
 * What a research run costs (`.context/story-research.md`, "Cost"): USD for a call's tokens with
 * `config.research` prices, and a run's per-step and total sums, Tavily included. A call to a model
 * with the cache controls is priced as billed: it caches only at its prompt's breakpoint, and the
 * answer reports the tokens written. Any other model's uncached input counts at the cache-write
 * factor, an upper bound, since OpenAI's default may write it unasked. Pure.
 */
import { config } from '../config.js'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { takesCacheControls } from '../lib/promptCache.js'
import { STEPS, type StepCall, type StepName, type StepUsage } from './researchPipeline.js'

export function hasPrice(model: string): boolean {
  return config.research.modelPrices[model] !== undefined
}

/** USD for one call. `output` already includes reasoning tokens, as the API reports and bills them. */
export function callCostUsd(model: string, usage: StepUsage): number {
  const p = config.research.modelPrices[model]
  if (!p) throw new Error(`No research price for model ${model}`)
  const readsAndOutput = usage.cached * p.cached + usage.output * p.output
  if (!takesCacheControls(model)) {
    const uncached = Math.max(0, usage.input - usage.cached)
    return (uncached * p.input * config.research.cacheWriteFactor + readsAndOutput) / 1_000_000
  }
  const written = usage.cacheWrite ?? 0
  const uncached = Math.max(0, usage.input - usage.cached - written)
  return (uncached * p.input + written * p.cacheWrite + readsAndOutput) / 1_000_000
}

export interface CostLine {
  calls: number
  usage: StepUsage
  usd: number
  /** The model ids that answered, in the order they first did. */
  models: string[]
}

export interface RunCostSummary {
  /** Steps that made a call, in step order. */
  steps: ({ step: StepName } & CostLine)[]
  /** All model calls together. */
  model: CostLine
  tavily: { credits: number; usd: number }
  totalUsd: number
}

const emptyLine = (): CostLine => ({ calls: 0, usage: { ...ZERO_USAGE }, usd: 0, models: [] })

function add(line: CostLine, c: StepCall): void {
  line.calls++
  line.usage.input += c.usage.input
  line.usage.cached += c.usage.cached
  line.usage.cacheWrite = (line.usage.cacheWrite ?? 0) + (c.usage.cacheWrite ?? 0)
  line.usage.output += c.usage.output
  line.usage.reasoning += c.usage.reasoning
  line.usd += c.costUsd
  if (!line.models.includes(c.model)) line.models.push(c.model)
}

/** A run's cost: the calls at what they were billed when made, and its credits at `tavilyUsdPerCredit`. */
export function summarizeRunCost(run: { calls: StepCall[]; credits: number }, tavilyUsdPerCredit: number): RunCostSummary {
  const perStep = new Map<StepName, CostLine>()
  const model = emptyLine()
  for (const c of run.calls) {
    const line = perStep.get(c.step) ?? emptyLine()
    perStep.set(c.step, line)
    add(line, c)
    add(model, c)
  }
  const steps = STEPS.flatMap(step => {
    const line = perStep.get(step)
    return line ? [{ step, ...line }] : []
  })
  const tavily = { credits: run.credits, usd: run.credits * tavilyUsdPerCredit }
  return { steps, model, tavily, totalUsd: model.usd + tavily.usd }
}
