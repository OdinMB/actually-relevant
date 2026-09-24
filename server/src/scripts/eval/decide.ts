/**
 * Decision rules shared by the suites: the noise-floor relaxation and
 * "lowest passing effort wins".
 */
import { REASONING_EFFORTS, type ReasoningEffort } from '../../config.js'
import type { Decision } from './types.js'

/**
 * An absolute "≥" bar, relaxed to the noise floor minus 5 points only when
 * the baseline's own rerun misses it.
 */
export function effectiveBar(absolute: number, baselineRerun: number | null): number {
  if (baselineRerun == null || baselineRerun >= absolute) return absolute
  return baselineRerun - 0.05
}

export function effortOf(armKey: string): ReasoningEffort {
  const effort = armKey.split('@')[1]
  const known = REASONING_EFFORTS.find(e => e === effort)
  if (!known) throw new Error(`Arm key without a known effort: ${armKey}`)
  return known
}

const effortRank = (armKey: string) => REASONING_EFFORTS.indexOf(effortOf(armKey))

export interface CandidateCheck {
  arm: string
  failures: string[]
  evidence?: string[]
}

/** The winner is the lowest-effort candidate with no failing check. */
export function pickLowestPassing(candidates: CandidateCheck[]): Decision {
  const sorted = [...candidates].sort((a, b) => effortRank(a.arm) - effortRank(b.arm))
  const passing = sorted.filter(c => c.failures.length === 0)
  if (passing.length === 0) {
    return {
      verdict: { kind: 'none', reasons: sorted.flatMap(c => c.failures.map(f => `${c.arm}: ${f}`)) },
      passing: [],
    }
  }
  return {
    verdict: { kind: 'winner', arm: passing[0].arm, evidence: passing[0].evidence ?? [] },
    passing: passing.map(c => c.arm),
  }
}
