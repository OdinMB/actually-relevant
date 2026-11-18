/**
 * The `closure` and `replay` bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"),
 * scored on the sandbox's replay of the whole module per development (`replay.ts`): linking and the
 * upkeep day by day. `closure`: no premature closure at an end event (before the key's end, or of a
 * development the key says is open: Uganda's end for Congo's Ebola), and the developments whose end
 * our stories report closed within 14 days of it. `replay`: the linking bars on the end state, the
 * three checkpoints of each development (at a third, two thirds and the last of its must entries)
 * with its overview's status, scope, members and stands, the share of checkpoints with enough
 * offerable facts for the stands, how often each safeguard fired, and the cost per story and per
 * overview. Means over runs. Pure.
 */
import type { OverviewScope, OverviewStatus } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'
import { bar, mean, ratio, scoreLinking, type Bar, type LinkScore, type ReplayRun } from './linkScore.js'

/** Days after the key's end within which the overview must have closed. */
export const CLOSED_WITHIN_DAYS = 14
export const CLOSED_BAR = 0.8

export const CHECKPOINTS = ['third', 'two-thirds', 'end'] as const
export type CheckpointName = (typeof CHECKPOINTS)[number]

/** The days a development is looked at: its must entries' dates at a third, two thirds and the last (each once). */
export function checkpointsOf(key: AnswerKey): { at: CheckpointName; day: string }[] {
  const days = key.entries
    .filter(e => e.join === 'must')
    .map(e => e.date)
    .sort()
  if (days.length === 0) return []
  const at = (share: number) => days[Math.max(0, Math.ceil(days.length * share) - 1)]!
  const points = [
    { at: 'third' as const, day: at(1 / 3) },
    { at: 'two-thirds' as const, day: at(2 / 3) },
    { at: 'end' as const, day: days.at(-1)! },
  ]
  return points.filter((p, i) => points.findIndex(q => q.day === p.day) === i)
}

/** A development's overview as it stood at a checkpoint. */
export interface CheckpointState {
  key: string
  at: CheckpointName
  day: string
  /** Null when no overview held its must entries yet. */
  overview: { id: string; status: OverviewStatus; scope: OverviewScope; frozen: boolean } | null
  /** Its must entries published by then, and those active in its overview. */
  mustByThen: number
  mustFound: number
  /** Members that are no must or optional entry of it. */
  wrongMembers: number
  /** The facts its stands could be written from then, and the stands then current. */
  offerable: number
  stands: { sentences: number; doing: number } | null
}

/** An overview's closure in a replay. */
export interface Closure {
  overviewId: string
  /** The development it stands for, or null. */
  development: string | null
  reason: 'end_event' | 'faded'
  day: string
}

export interface ReplayRunResult extends ReplayRun {
  checkpoints: CheckpointState[]
  closures: Closure[]
  /** Each safeguard's firings: refused links and foundings, closings refused or cancelled, review actions, bursts. */
  safeguards: Record<string, number>
  costUsd: number
  /** Overviews founded. */
  founded: number
}

export interface ClosureRunScore {
  run: number
  premature: string[]
  /** Developments whose end our stories report, and those closed in time. */
  closable: number
  closedInTime: number
}

export interface ReplayScore {
  link: LinkScore
  closure: Bar[]
  closureRuns: ClosureRunScore[]
  /** Checkpoints with at least `minStandsFacts` offerable facts, of all checkpoints, per run mean. */
  evidenceShare: number | null
  /** Safeguard firings per run, averaged. */
  safeguards: Record<string, number>
  costPerStoryUsd: number | null
  costPerOverviewUsd: number | null
}

const dayAfter = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export function scoreClosures(keys: readonly AnswerKey[], r: ReplayRunResult): ClosureRunScore {
  const byKey = new Map(keys.map(k => [k.id, k]))
  const premature: string[] = []
  for (const c of r.closures) {
    if (c.reason !== 'end_event' || !c.development) continue
    const k = byKey.get(c.development)
    if (!k?.closed) premature.push(`${c.development} closed on ${c.day}, still open in the key`)
    else if (c.day < k.closed.date) premature.push(`${c.development} closed on ${c.day}, before its end on ${k.closed.date}`)
  }
  const closable = keys.filter(k => k.closed?.slug)
  const closedInTime = closable.filter(k =>
    r.closures.some(
      c => c.reason === 'end_event' && c.development === k.id && c.day >= k.closed!.date && c.day <= dayAfter(k.closed!.date, CLOSED_WITHIN_DAYS),
    ),
  ).length
  return { run: r.run, premature, closable: closable.length, closedInTime }
}

/** The bars over every run, and the replay's figures. */
export function scoreReplay(keys: readonly AnswerKey[], runs: readonly ReplayRunResult[], minStandsFacts: number, stories: number): ReplayScore {
  const closureRuns = runs.map(r => scoreClosures(keys, r))
  const names = [...new Set(runs.flatMap(r => Object.keys(r.safeguards)))].sort()
  const totalUsd = runs.reduce((s, r) => s + r.costUsd, 0)
  const founded = runs.reduce((s, r) => s + r.founded, 0)
  return {
    link: scoreLinking(keys, runs),
    closure: [
      bar('premature closures', mean(closureRuns.map(c => c.premature.length)), 0, 'atMost'),
      bar(`closed within ${CLOSED_WITHIN_DAYS} days of the end`, mean(closureRuns.map(c => ratio(c.closedInTime, c.closable))), CLOSED_BAR),
    ],
    closureRuns,
    evidenceShare: mean(runs.map(r => ratio(r.checkpoints.filter(c => c.offerable >= minStandsFacts).length, r.checkpoints.length))),
    safeguards: Object.fromEntries(names.map(n => [n, runs.reduce((s, r) => s + (r.safeguards[n] ?? 0), 0) / Math.max(1, runs.length)])),
    costPerStoryUsd: stories === 0 || runs.length === 0 ? null : totalUsd / (stories * runs.length),
    costPerOverviewUsd: founded === 0 ? null : totalUsd / founded,
  }
}
