/**
 * The price table of the model eval and of the task spend cap (`lib/spendCap.ts`): what an OpenAI
 * model's tokens, an embedding's input and a Tavily credit cost, and the most output one answer of
 * each model can bill. Constants only, never read from `config`, so an env override on the machine
 * running an eval can change neither what is compared nor what the cap reserves. Production's job
 * costs read their own rows (`config.llm.modelPrices`).
 */
import { takesCacheControls } from './promptCache.js'

export type ModelId = 'gpt-5-nano' | 'gpt-5-mini' | 'gpt-5.2' | 'gpt-6-luna' | 'gpt-6-sol' | 'gpt-6.1-sol'

export interface ModelPrice {
  /** USD per 1M tokens. */
  input: number
  cached: number
  output: number
  /** What a token written to the cache costs, as a multiple of `input` (GPT-5.6+ bill writes at 1.25×). */
  cacheWrite: number
  /** Output-token multiplier used for dry-run estimates (Luna writes ~25% more). */
  outputFactor: number
  source: string
  verified: boolean
  /**
   * The most output tokens, reasoning included, one answer can bill: what the spend cap reserves for a
   * request that sets no lower limit. Null refuses the model under a cap.
   */
  maxOutputTokens: number | null
  maxOutputSource: string
}

const GPT5_MAX_OUTPUT = { maxOutputTokens: 128_000, maxOutputSource: "OpenAI's model page (GPT-5 family: 128,000 output tokens), not rechecked" }
const GPT6_MAX_OUTPUT = { maxOutputTokens: 128_000, maxOutputSource: "OpenAI's GPT-6 docs: 128,000 output tokens" }

/**
 * Price table. Baseline and candidate IDs are constants here, never read from
 * `config`, so an env override on the machine running the eval cannot
 * silently change what is being compared.
 */
export const MODELS: Record<ModelId, ModelPrice> = {
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4, cacheWrite: 1, outputFactor: 1, source: 'research brief', verified: true, ...GPT5_MAX_OUTPUT },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.0, cacheWrite: 1, outputFactor: 1, source: 'research brief', verified: true, ...GPT5_MAX_OUTPUT },
  'gpt-5.2': {
    input: 1.75,
    cached: 0.175,
    output: 14.0,
    cacheWrite: 1,
    outputFactor: 1,
    source: 'from memory, not in the research brief',
    verified: false,
    ...GPT5_MAX_OUTPUT,
  },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5, cacheWrite: 1.25, outputFactor: 1.25, source: 'research brief', verified: true, ...GPT6_MAX_OUTPUT },
  'gpt-6-sol': { input: 2.0, cached: 0.2, output: 10.0, cacheWrite: 1.25, outputFactor: 1, source: 'research brief', verified: true, ...GPT6_MAX_OUTPUT },
  // Input and output from search snippets of OpenAI pages (2026-10-27). Secondary sources report
  // cached input at 0.1; gpt-6-sol's 0.2 is kept as the upper bound so the budget guard never
  // undercounts. Cache writes assumed at 1.25× like the rest of GPT-6.
  'gpt-6.1-sol': {
    input: 2.0,
    cached: 0.2,
    output: 10.0,
    cacheWrite: 1.25,
    outputFactor: 1,
    source: 'OpenAI pages via search snippets, 2026-10-27; cached rate and cache write assumed as gpt-6-sol',
    verified: false,
    ...GPT6_MAX_OUTPUT,
  },
}

/** USD per 1M input tokens of an embedding model (an embedding bills no output). */
export const EMBEDDING_PRICES: Record<string, { input: number; source: string } | undefined> = {
  'text-embedding-3-small': { input: 0.02, source: "OpenAI's pricing page, the row config.llm.modelPrices holds" },
}

/**
 * Pay-as-you-go price per Tavily credit (eval:research's design, "Price"); free credits are counted
 * as paid by the eval's budget and by the cap. Kept beside `config.research.tavilyUsdPerCredit` on
 * purpose, as the model prices are.
 */
export const TAVILY_USD_PER_CREDIT = 0.008

/** The model's row; undefined for an id the table does not hold. */
export function modelPrice(model: string): ModelPrice | undefined {
  return (MODELS as Record<string, ModelPrice | undefined>)[model]
}

export function priceOf(model: string): ModelPrice {
  const price = modelPrice(model)
  if (!price) throw new Error(`No price for model ${model}`)
  return price
}

/** Token counts as an answer reports them: `cached` and `cacheWrite` are parts of `input`, `reasoning` of `output`. */
export interface BilledTokens {
  input: number
  cached: number
  cacheWrite?: number
  output: number
  /** Already inside `output`, so never billed apart. */
  reasoning?: number
}

/**
 * USD for one call. `output` already includes reasoning tokens (that is how
 * the API reports and bills them). A model with the cache controls is priced
 * as billed: it caches only at a prompt's breakpoint, and its answer reports
 * the tokens written. Any other model's uncached input carries the cache-write
 * surcharge, a conservative upper bound (OpenAI's default may write unasked).
 */
export function costOf(model: ModelId, usage: BilledTokens): number {
  const p = priceOf(model)
  const reads = usage.cached * p.cached + usage.output * p.output
  if (!takesCacheControls(model)) {
    const uncached = Math.max(0, usage.input - usage.cached)
    return (uncached * p.input * p.cacheWrite + reads) / 1_000_000
  }
  const written = usage.cacheWrite ?? 0
  const uncached = Math.max(0, usage.input - usage.cached - written)
  return (uncached * p.input + written * p.input * p.cacheWrite + reads) / 1_000_000
}
