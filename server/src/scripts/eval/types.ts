/**
 * Types shared by the model-eval suites, runner and reports.
 */
import type { z } from 'zod'
import type { ReasoningEffort } from '../../config.js'
import type { Fixtures } from './fixtures.js'

export type ModelId = 'gpt-5-nano' | 'gpt-5-mini' | 'gpt-5.2' | 'gpt-6-luna' | 'gpt-6-sol'

/** One model at one reasoning effort. Its key is `model@effort`. */
export interface Arm {
  model: ModelId
  effort: ReasoningEffort
}

/**
 * `skipped` is harness-level (budget exhausted, no call made); the other
 * outcomes describe what the model returned.
 */
export type CallOutcome = 'ok' | 'parse_failure' | 'empty' | 'truncated' | 'error' | 'skipped'

export interface TokenUsage {
  input: number
  /** Input tokens served from the prompt cache (subset of `input`). */
  cached: number
  /** Billed output tokens, reasoning included. */
  output: number
  /** Reasoning tokens (subset of `output`). */
  reasoning: number
}

export interface CallRecord<T = unknown> {
  key: string
  arm: string
  schema: string
  outcome: CallOutcome
  parsed: T | null
  content: string
  finishReason: string | null
  usage: TokenUsage
  costUsd: number
  latencyMs: number
  error?: string
  at: string
}

/** A call a suite intends to make, used for dry-run estimates and the budget gate. */
export interface PlannedCall {
  arm: Arm
  schemaName: string
  prompt: string
  /** Expected billed output tokens for today's baseline at medium effort. */
  baseOutputTokens: number
}

export interface SuiteContext {
  call<T>(arm: Arm, schemaName: string, schema: z.ZodType<T>, prompt: string): Promise<CallRecord<T>>
  /** Max fixture items per suite part (`--limit`), or undefined for all. */
  limit?: number
}

export type SuiteName = 'preassess' | 'assess' | 'dedup' | 'related' | 'social' | 'large'

export interface Suite {
  name: SuiteName
  /** Every arm the suite may call (judges included), for the `--api-check` probe. */
  arms: Arm[]
  /** Fixture counts against their targets, one line each. */
  describe(fx: Fixtures, limit?: number): string[]
  /** Every call the run will make whose prompt is known up front. */
  plan(fx: Fixtures, limit?: number): PlannedCall[]
  /** Extra estimated spend for calls that depend on results (e.g. dedup judges). */
  extraEstimateUsd?(fx: Fixtures, limit?: number): number
  run(fx: Fixtures, ctx: SuiteContext): Promise<SuiteResult>
}

export interface ArmStats {
  arm: string
  calls: number
  outcomes: Record<CallOutcome, number>
  latencyP50: number | null
  latencyP95: number | null
  meanUsage: TokenUsage
  meanCostUsd: number
  totalCostUsd: number
}

export interface MetricRow {
  name: string
  /** Formatted value per arm key. */
  values: Record<string, string>
  /** Raw value per arm key, for baseline-vs-candidate comparisons. */
  raw: Record<string, number | null>
  /** Which direction is better; omitted for purely informational rows. */
  better?: 'higher' | 'lower'
}

export type Verdict =
  | { kind: 'winner'; arm: string; evidence: string[] }
  | { kind: 'none'; reasons: string[] }
  | { kind: 'info'; text: string }

export interface Decision {
  verdict: Verdict
  /** Candidate arm keys that pass every automated check. */
  passing: string[]
}

export type CallSiteId =
  | 'preassess'
  | 'assess'
  | 'dedup'
  | 'related'
  | 'social-pick'
  | 'social-post'
  | 'selection'
  | 'newsletter-select'
  | 'newsletter-intro'
  | 'podcast'

export type RatingSetSlug =
  | 'full-assessment'
  | 'social-post'
  | 'newsletter-intro'
  | 'podcast-script'
  | 'story-selection'

export interface CallSiteResult {
  id: CallSiteId
  title: string
  baseline: string
  candidates: string[]
  stats: ArmStats[]
  metrics: MetricRow[]
  decision: Decision
  /** Set when the owner still has to rate this call site. */
  ratingSet?: RatingSetSlug
  notes: string[]
}

/** A candidate rating item before capping, picking and label assignment. */
export interface RatingItemDraft {
  set: RatingSetSlug
  /** Stable fixture key (story ID, group ID); never shown to the rater. */
  key: string
  context_md: string
  options: { arm: string; content_md: string }[]
  /** Strata the set's picking rule reads. */
  tags: Record<string, string | number | boolean>
}

export interface SuiteResult {
  callSites: CallSiteResult[]
  ratingItems: RatingItemDraft[]
  notes: string[]
}
