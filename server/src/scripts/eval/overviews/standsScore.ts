/**
 * The `stands` bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored on the
 * stands written at each development's checkpoints (`stands.ts`), over the checkpoints with at least
 * `minStandsFacts` offerable facts only: lines the strong judge finds unsupported after production's
 * checks (none); each figure's latest key value as of the checkpoint stated when an offered fact holds
 * it (≥90%); "What's being done" present where the key has a sourced response by then that an offered
 * fact reports (≥70%), and never unsupported. Below `STANDS_MIN_CHECKPOINTS` such checkpoints the
 * bars report "not enough evidence" and none is met. Pure.
 */
import type { StandsOutcome } from '../../../services/overviewStands.js'
import type { AnswerKey } from './keySchema.js'
import { bar, mean, ratio, type Bar } from './linkScore.js'
import type { CheckpointName } from './replayScore.js'

export const STANDS_MIN_CHECKPOINTS = 15
export const LATEST_VALUE_BAR = 0.9
export const DOING_PRESENT_BAR = 0.7

export interface StandsCheckpointRun {
  key: string
  at: CheckpointName
  day: string
  run: number
  /** Facts offered, and whether they reach `minStandsFacts`. */
  offered: number
  enough: boolean
  /** Null where there was not enough evidence to write. */
  outcome: StandsOutcome | null
  lines: { part: 'sentence' | 'doing'; text: string; supported: boolean | null }[]
  /** Each figure's latest key value by then that an offered fact holds, and whether a sentence states it. */
  latest: { figure: string; value: number; stated: boolean }[]
  /** The key has a response by then, sourced by an entry, that a current offered fact of that entry reports. */
  responseDue: boolean
  doingPresent: boolean
  costUsd: number
}

/** Each figure's latest value in the key as of `day`: among values that match their figure, from entries published by then, the newest as-of. */
export function latestValues(key: AnswerKey, day: string): { figure: string; value: number }[] {
  const latest = new Map<string, { value: number; asOf: string }>()
  for (const e of key.entries) {
    if (e.date > day) continue
    for (const v of e.values) {
      if (!v.matches || v.asOf > day) continue
      const was = latest.get(v.figure)
      if (!was || v.asOf >= was.asOf) latest.set(v.figure, { value: v.value, asOf: v.asOf })
    }
  }
  return [...latest].map(([figure, v]) => ({ figure, value: v.value }))
}

const SCALES: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, m: 1e6, mn: 1e6, billion: 1e9, bn: 1e9 }

/** The numbers a text states, scaled ("2.9 million" is 2,900,000), each with whether a scale word rounded it. */
export function numbersIn(text: string): { value: number; scaled: boolean }[] {
  const out: { value: number; scaled: boolean }[] = []
  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(thousand|million|billion|mn|bn|k|m)?(?![a-z])/gi)) {
    const base = Number(`${m[1]!.replace(/,/g, '')}${m[2] ?? ''}`)
    const scale = m[3] ? SCALES[m[3].toLowerCase()]! : 1
    out.push({ value: base * scale, scaled: scale !== 1 })
  }
  return out
}

/** Whether a text states a value: exactly, or within 5% when written with a scale word ("about 2.9 million" for 2,880,000). */
export function statesValue(text: string, value: number): boolean {
  return numbersIn(text).some(n => (n.scaled ? Math.abs(n.value - value) <= Math.abs(value) * 0.05 : n.value === value))
}

export interface StandsScore {
  /** Distinct checkpoints, and those with enough offerable facts. */
  checkpoints: number
  enough: number
  bars: Bar[]
  /** Why no bar is met: too few checkpoints with enough evidence. */
  note: string | null
}

export function scoreStands(runs: readonly StandsCheckpointRun[], minCheckpoints: number = STANDS_MIN_CHECKPOINTS): StandsScore {
  const points = new Set(runs.map(r => `${r.key}@${r.day}`))
  const enoughPoints = new Set(runs.filter(r => r.enough).map(r => `${r.key}@${r.day}`))
  const byRun = [...new Set(runs.map(r => r.run))].map(n => runs.filter(r => r.run === n && r.enough))
  const unsupported = (part: 'sentence' | 'doing') =>
    mean(byRun.map(rs => rs.reduce((s, r) => s + r.lines.filter(l => l.part === part && l.supported === false).length, 0)))
  const latest = mean(
    byRun.map(rs =>
      ratio(
        rs.reduce((s, r) => s + r.latest.filter(l => l.stated).length, 0),
        rs.reduce((s, r) => s + r.latest.length, 0),
      ),
    ),
  )
  const present = mean(byRun.map(rs => ratio(rs.filter(r => r.responseDue && r.doingPresent).length, rs.filter(r => r.responseDue).length)))
  const bars = [
    bar('unsupported sentences', unsupported('sentence'), 0, 'atMost'),
    bar('latest value stated', latest, LATEST_VALUE_BAR),
    bar("what's being done present", present, DOING_PRESENT_BAR),
    bar("what's being done unsupported", unsupported('doing'), 0, 'atMost'),
  ]
  const short = enoughPoints.size < minCheckpoints
  return {
    checkpoints: points.size,
    enough: enoughPoints.size,
    bars: short ? bars.map(b => ({ ...b, met: null })) : bars,
    note: short ? `not enough evidence: ${enoughPoints.size} of the ${minCheckpoints} checkpoints with enough offerable facts the bars need` : null,
  }
}
