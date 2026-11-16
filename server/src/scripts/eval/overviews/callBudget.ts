/**
 * Whether a pass of `eval:overviews` may make its planned calls: what the cache cannot answer is
 * priced (`estimateCallUsd`) and must fit what is left of the folder's budget, and needs the API
 * key. A pass the cache answers in full always runs, so a re-run of a finished run is never refused.
 * Pure but for the ledger it is given.
 */
import { estimateCallUsd, type EvalContext } from '../models.js'
import type { PlannedCall } from '../types.js'

export interface CallEstimate {
  calls: number
  /** Calls the cache cannot answer. */
  uncached: number
  /** Their estimated cost. */
  usd: number
}

export interface CallGate {
  budgetUsd: number
  /** Whether an uncached call can reach the API: `OPENAI_API_KEY` is set. */
  canCall: boolean
}

export type Ledger = Pick<EvalContext, 'isCached' | 'spentUsd'>

const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`

export function estimateCalls(ledger: Pick<Ledger, 'isCached'>, calls: PlannedCall[]): CallEstimate {
  const uncached = calls.filter(c => !ledger.isCached(c))
  return { calls: calls.length, uncached: uncached.length, usd: uncached.reduce((sum, c) => sum + estimateCallUsd(c), 0) }
}

/** Why the estimated calls may not go ahead, or null when they may. */
export function refusal(estimate: CallEstimate, ledger: Pick<Ledger, 'spentUsd'>, gate: CallGate): string | null {
  if (estimate.uncached === 0) return null
  if (!gate.canCall) return `${estimate.uncached} uncached calls and OPENAI_API_KEY is missing`
  const left = gate.budgetUsd - ledger.spentUsd()
  return estimate.usd > left ? `estimate ${usd(estimate.usd)} for ${estimate.uncached} uncached calls exceeds the remaining budget ${usd(left)}` : null
}
