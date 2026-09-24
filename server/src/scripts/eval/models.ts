/**
 * One metered, cached, budget-guarded structured-output call for an eval arm.
 *
 * Calls go through the production client factory (`createChatModel`) and
 * `withStructuredOutput`, so the eval exercises the exact request the app
 * sends. They are deliberately NOT wrapped in `withRetry`: parse failures and
 * declines are what the eval measures. Transport retries come from
 * ChatOpenAI's own `maxRetries: 3`.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { HumanMessage, type AIMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import type { ReasoningEffort } from '../../config.js'
import { Semaphore } from '../../lib/semaphore.js'
import { createChatModel } from '../../services/llm.js'
import type { Arm, CallOutcome, CallRecord, ModelId, PlannedCall, SuiteContext, TokenUsage } from './types.js'

interface ModelPrice {
  /** USD per 1M tokens. */
  input: number
  cached: number
  output: number
  /** Multiplier on uncached input for cache writes (GPT-5.6+ bill writes at 1.25×). */
  cacheWrite: number
  /** Output-token multiplier used for dry-run estimates (Luna writes ~25% more). */
  outputFactor: number
  source: string
  verified: boolean
}

/**
 * Price table. Baseline and candidate IDs are constants here, never read from
 * `config`, so an env override on the machine running the eval cannot
 * silently change what is being compared.
 */
export const MODELS: Record<ModelId, ModelPrice> = {
  'gpt-5-nano': { input: 0.05, cached: 0.005, output: 0.4, cacheWrite: 1, outputFactor: 1, source: 'research brief', verified: true },
  'gpt-5-mini': { input: 0.25, cached: 0.025, output: 2.0, cacheWrite: 1, outputFactor: 1, source: 'research brief', verified: true },
  'gpt-5.2': { input: 1.75, cached: 0.175, output: 14.0, cacheWrite: 1, outputFactor: 1, source: 'from memory, not in the research brief', verified: false },
  'gpt-6-luna': { input: 0.1, cached: 0.01, output: 0.5, cacheWrite: 1.25, outputFactor: 1.25, source: 'research brief', verified: true },
  'gpt-6-sol': { input: 2.0, cached: 0.2, output: 10.0, cacheWrite: 1.25, outputFactor: 1, source: 'research brief', verified: true },
}

const EFFORT_OUTPUT_FACTOR: Partial<Record<ReasoningEffort, number>> = { low: 0.4, medium: 1, high: 1.5 }

export function arm(model: ModelId, effort: ReasoningEffort): Arm {
  return { model, effort }
}

export function armKey(a: Arm): string {
  return `${a.model}@${a.effort}`
}

function priceOf(model: string): ModelPrice {
  const price = (MODELS as Record<string, ModelPrice | undefined>)[model]
  if (!price) throw new Error(`No price for model ${model}`)
  return price
}

/**
 * USD for one call. `output` already includes reasoning tokens (that is how
 * the API reports and bills them); uncached input carries the cache-write
 * surcharge, a conservative upper bound because Chat Completions usage does
 * not report cache writes separately.
 */
export function costOf(model: ModelId, usage: TokenUsage): number {
  const p = priceOf(model)
  const uncached = Math.max(0, usage.input - usage.cached)
  return (uncached * p.input * p.cacheWrite + usage.cached * p.cached + usage.output * p.output) / 1_000_000
}

export type OutcomeInput =
  | { parsed: unknown; content: string; finishReason: string | null }
  | { error: unknown }

export function classifyOutcome(input: OutcomeInput): CallOutcome {
  if ('error' in input) return 'error'
  if (input.finishReason === 'length') return 'truncated'
  if (input.parsed != null) return 'ok'
  return input.content.trim() !== '' ? 'parse_failure' : 'empty'
}

const HAN = /\p{Script=Han}/gu

/** Rough input-token estimate: Han characters ≈ 1 token each, other text ≈ 4 chars per token. */
export function estimateInputTokens(text: string): number {
  const han = text.match(HAN)?.length ?? 0
  return Math.ceil(han + (text.length - han) / 4)
}

export function estimateCallUsd(call: PlannedCall): number {
  const p = priceOf(call.arm.model)
  const effortFactor = EFFORT_OUTPUT_FACTOR[call.arm.effort] ?? 1
  const output = Math.round(call.baseOutputTokens * p.outputFactor * effortFactor)
  return costOf(call.arm.model, { input: estimateInputTokens(call.prompt), cached: 0, output, reasoning: 0 })
}

export function cacheKey(a: Arm, schemaName: string, prompt: string): string {
  return createHash('sha256').update(`${armKey(a)}\n${schemaName}\n${prompt}`).digest('hex')
}

// ---------------------------------------------------------------------------
// Eval context: cache + ledger + budget + concurrency
// ---------------------------------------------------------------------------

export interface EvalContext extends SuiteContext {
  /** Total USD recorded in the ledger (all runs against this output dir). */
  spentUsd(): number
  /** USD recorded by calls made in this process. */
  spentThisRunUsd(): number
  isCached(call: PlannedCall): boolean
  liveCalls(): number
}

export interface EvalContextOptions {
  cacheFile: string
  budgetUsd: number
  concurrency: number
  limit?: number
  /** When true, any uncached call throws: a dry run must not reach the API. */
  offline: boolean
}

function readLedger(file: string): Map<string, CallRecord> {
  const records = new Map<string, CallRecord>()
  if (!existsSync(file)) return records
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const rec = JSON.parse(line) as CallRecord
    records.set(rec.key, rec)
  }
  return records
}

function usageFrom(message: AIMessage): TokenUsage {
  const u = message.usage_metadata
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.input_token_details?.cache_read ?? 0,
    output: u?.output_tokens ?? 0,
    reasoning: u?.output_token_details?.reasoning ?? 0,
  }
}

function contentText(message: AIMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

function finishReasonOf(message: AIMessage): string | null {
  const reason = message.response_metadata?.finish_reason
  return typeof reason === 'string' ? reason : null
}

const ZERO_USAGE: TokenUsage = { input: 0, cached: 0, output: 0, reasoning: 0 }

export function createEvalContext(options: EvalContextOptions): EvalContext {
  mkdirSync(dirname(options.cacheFile), { recursive: true })
  const ledger = readLedger(options.cacheFile)
  const semaphore = new Semaphore(options.concurrency)
  let spent = [...ledger.values()].reduce((sum, r) => sum + r.costUsd, 0)
  let spentThisRun = 0
  let live = 0

  function record<T>(rec: CallRecord<T>): CallRecord<T> {
    // Errors are not cached, so a resumed run retries them; they cost nothing.
    if (rec.outcome === 'error' || rec.outcome === 'skipped') return rec
    appendFileSync(options.cacheFile, JSON.stringify(rec) + '\n')
    ledger.set(rec.key, rec)
    spent += rec.costUsd
    spentThisRun += rec.costUsd
    return rec
  }

  async function invoke<T>(a: Arm, schemaName: string, schema: z.ZodType<T>, prompt: string, key: string): Promise<CallRecord<T>> {
    const base = { key, arm: armKey(a), schema: schemaName, at: new Date().toISOString() }
    if (spent >= options.budgetUsd) {
      return { ...base, outcome: 'skipped', parsed: null, content: '', finishReason: null, usage: ZERO_USAGE, costUsd: 0, latencyMs: 0, error: 'budget exhausted' }
    }
    const model = createChatModel({ name: a.model, reasoningEffort: a.effort })
    const structured = model.withStructuredOutput(schema, { includeRaw: true })
    const started = Date.now()
    live++
    try {
      const result = await structured.invoke([new HumanMessage(prompt)])
      const latencyMs = Date.now() - started
      const raw = result.raw as AIMessage
      const content = contentText(raw)
      const finishReason = finishReasonOf(raw)
      const parsed = (result.parsed ?? null) as T | null
      const usage = usageFrom(raw)
      return record({
        ...base,
        outcome: classifyOutcome({ parsed, content, finishReason }),
        parsed,
        content,
        finishReason,
        usage,
        costUsd: costOf(a.model, usage),
        latencyMs,
      })
    } catch (err) {
      return {
        ...base,
        outcome: classifyOutcome({ error: err }),
        parsed: null,
        content: '',
        finishReason: null,
        usage: ZERO_USAGE,
        costUsd: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 500) : String(err),
      }
    }
  }

  return {
    limit: options.limit,
    async call<T>(a: Arm, schemaName: string, schema: z.ZodType<T>, prompt: string): Promise<CallRecord<T>> {
      const key = cacheKey(a, schemaName, prompt)
      const hit = ledger.get(key)
      if (hit) return hit as CallRecord<T>
      if (options.offline) throw new Error(`offline run tried to call ${armKey(a)} (${schemaName})`)
      return semaphore.run(() => invoke(a, schemaName, schema, prompt, key))
    },
    spentUsd: () => spent,
    spentThisRunUsd: () => spentThisRun,
    isCached: (call) => ledger.has(cacheKey(call.arm, call.schemaName, call.prompt)),
    liveCalls: () => live,
  }
}
