/**
 * What a job run spends, and whether its model calls use flex processing (`.context/scheduler.md`,
 * "Cost and flex"). The scheduler opens a run scope around each job's handler (`runInScope`); every
 * OpenAI request made inside it, however deep in the job's code, finds it through AsyncLocalStorage
 * (`services/openaiFetch.ts`), asks it whether to go at flex and records its tokens in it. A step of a
 * chain is a scope inside its chain's scope: it takes the chain's flex cut-off and deadline, and what
 * it records counts for the chain too. Outside any scope (a person's click in the admin, a script)
 * nothing is recorded and every call goes at standard price.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from '../config.js'

export interface RunUsage {
  /** Model and embedding calls answered. */
  calls: number
  /** Calls OpenAI answered at flex price. */
  flexCalls: number
  /** Calls asked at flex that OpenAI refused as busy until they were sent at standard price. */
  flexFallbacks: number
  inputTokens: number
  /** Input tokens served from the prompt cache (part of `inputTokens`). */
  cachedTokens: number
  outputTokens: number
  /** USD for the calls at the price each was billed at, plus `otherUsd`. */
  costUsd: number
  /** USD the same calls would have cost at standard price, plus `otherUsd`. */
  standardCostUsd: number
  /** Calls to a model with no price on record (`config.llm.modelPrices`), left out of the sums. */
  unpricedCalls: number
  /** Other paid services the run used (research's web searches), part of both sums. */
  otherUsd: number
}

export interface RunScope {
  jobName: string
  /** This job's Flex switch. */
  flex: boolean
  /** After this time calls go at standard price, flex or not (a chain's flex cut-off). */
  flexUntil: Date | null
  /** A chain's "done by" time: a step that works through items starts no new one after it. */
  deadline: Date | null
  usage: RunUsage
  parent: RunScope | null
  /** Usage records still being read from responses; `settleRun` waits for them. */
  pending: Set<Promise<void>>
}

export const emptyUsage = (): RunUsage => ({
  calls: 0,
  flexCalls: 0,
  flexFallbacks: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  standardCostUsd: 0,
  unpricedCalls: 0,
  otherUsd: 0,
})

const storage = new AsyncLocalStorage<RunScope>()

/** The run scope of the code running now, or undefined outside a job run. */
export function currentRun(): RunScope | undefined {
  return storage.getStore()
}

/**
 * A scope for a run of `jobName`, inside the current scope when there is one (a chain's step). The
 * cut-off and deadline not given are the enclosing scope's.
 */
export function createRunScope(options: { jobName: string; flex: boolean; flexUntil?: Date | null; deadline?: Date | null }): RunScope {
  const parent = currentRun() ?? null
  return {
    jobName: options.jobName,
    flex: options.flex,
    flexUntil: options.flexUntil ?? parent?.flexUntil ?? null,
    deadline: options.deadline ?? parent?.deadline ?? null,
    usage: emptyUsage(),
    parent,
    pending: new Set(),
  }
}

export function runInScope<T>(scope: RunScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn)
}

/** Whether a model call made now in `scope` goes at flex. */
export function flexNow(scope: RunScope, now = Date.now()): boolean {
  return scope.flex && (scope.flexUntil === null || now < scope.flexUntil.getTime())
}

/** Whether the current run's deadline has passed; false outside a run or without one. */
export function runDeadlinePassed(now = Date.now()): boolean {
  const deadline = currentRun()?.deadline
  return deadline != null && now >= deadline.getTime()
}

export interface CallRecord {
  /** The model the request asked for. */
  model: string
  /** The tier OpenAI answered at. */
  tier: 'flex' | 'standard'
  input: number
  cached: number
  output: number
  /** The call was asked at flex, refused as busy and sent at standard price. */
  fellBack: boolean
}

/** USD for one call at standard price, or null for a model with no price on record. */
export function standardCallUsd(model: string, tokens: Pick<CallRecord, 'input' | 'cached' | 'output'>): number | null {
  const price = config.llm.modelPrices[model]
  if (!price) return null
  const uncached = Math.max(0, tokens.input - tokens.cached)
  return (uncached * price.input + tokens.cached * price.cached + tokens.output * price.output) / 1_000_000
}

/** Add one call to `scope` and every scope around it. */
export function recordCall(scope: RunScope, call: CallRecord): void {
  const standard = standardCallUsd(call.model, call)
  const billed = standard === null ? null : call.tier === 'flex' ? standard * config.llm.flex.priceFactor : standard
  for (let s: RunScope | null = scope; s; s = s.parent) {
    const u = s.usage
    u.calls++
    if (call.tier === 'flex') u.flexCalls++
    if (call.fellBack) u.flexFallbacks++
    u.inputTokens += call.input
    u.cachedTokens += call.cached
    u.outputTokens += call.output
    if (standard === null || billed === null) {
      u.unpricedCalls++
    } else {
      u.costUsd += billed
      u.standardCostUsd += standard
    }
  }
}

/** Add spending on another paid service to the current run and every run around it; no-op outside one. */
export function recordOtherCost(usd: number): void {
  for (let s = currentRun() ?? null; s; s = s.parent) {
    s.usage.otherUsd += usd
    s.usage.costUsd += usd
    s.usage.standardCostUsd += usd
  }
}

/** Keep `work` (reading a response's usage) until `settleRun` waits for it. */
export function track(scope: RunScope, work: Promise<void>): void {
  scope.pending.add(work)
  void work.finally(() => scope.pending.delete(work))
}

/** Wait for the usage records still being read, then return what the run spent. */
export async function settleRun(scope: RunScope): Promise<RunUsage> {
  while (scope.pending.size > 0) await Promise.allSettled([...scope.pending])
  return scope.usage
}
