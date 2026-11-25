/**
 * The `replay` bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored on the
 * sandbox's replay of the whole module per development (`replay.ts`): linking and the upkeep day by
 * day, the half's stories and, in a judged run, the background's. The linking bars on the end state (a
 * background story scored only as a wrong join in a judged development's overview, as `scoreLinking`
 * reads it), the three checkpoints of each development (at a third, two thirds and the last of its must
 * entries) with its overview's title, status, scope, wrong members by name and stands, the share of
 * checkpoints with enough offerable facts for the stands, how often each safeguard fired, and the cost
 * per story and per overview, the background's included; and the automated re-centers: none of a
 * development whose key has no center and no near miss joined by one (bars, which leave out a background
 * development's re-centers, counted apart), re-centers per overview, splits (an overview founded by two
 * center entries) and each re-center's day against its center's `from` (for the owner). Means over runs. Pure.
 */
import type { OverviewScope, OverviewStatus } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'
import { mean, ratio, RECENTER_MISTAKES_BAR, scoreLinking, shareBar, type Bar, type LinkScore, type ReplayRun } from './linkScore.js'

const sum = (values: number[]): number => values.reduce((s, v) => s + v, 0)

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
  /** Null when no overview held its must entries yet; `development`: the one it stands for (`linkKeys`' `standsFor`), which may be another key's. */
  overview: { id: string; title: string; development: string | null; status: OverviewStatus; scope: OverviewScope; frozen: boolean } | null
  /** Its must entries published by then, and those active in its overview. */
  mustByThen: number
  mustFound: number
  /**
   * While its overview stands for it, the active members the joins bar reads as wrong there (`linkKeys`'
   * `verdict`), each by name (`named`); none when the overview stands for another development.
   */
  wrongMembers: string[]
  /** The facts its stands could be written from then, and the stands then current. */
  offerable: number
  stands: { sentences: number; doing: number } | null
}

/**
 * The development an overview stood for when a re-center was decided: what its members stand for
 * without the stories the re-center took in. Read from its members afterwards, a judged overview that
 * swallowed more of a neighbouring development's stories than it holds must entries would stand for the
 * neighbour, and its re-center, the false one the bars exist for, would go unscored. Null when the
 * members left stand for none.
 */
export const developmentBefore = (
  members: readonly string[],
  joined: readonly string[],
  standsFor: (members: readonly string[]) => string | null,
): string | null => standsFor(members.filter(m => !joined.includes(m)))

/** An applied automated re-center in a replay: its overview, its day and the development it stood for then (`developmentBefore`), and the stories it joined, by slug. */
export interface ReplayRecenter {
  overviewId: string
  day: string
  development: string | null
  title: string
  joined: string[]
  /** The joined stories that are near misses of that development. */
  nearMissesJoined: string[]
}

export interface ReplayRunResult extends ReplayRun {
  checkpoints: CheckpointState[]
  recenters: ReplayRecenter[]
  /** Overviews founded by two center entries of one key (not two base entries): a split, for the owner, never a right founding. */
  splits: string[]
  /** Each safeguard's firings: refused links and foundings, review actions, bursts, re-center attempts. */
  safeguards: Record<string, number>
  costUsd: number
  /** Overviews founded. */
  founded: number
}

export interface ReplayScore {
  link: LinkScore
  /** Checkpoints with at least `minStandsFacts` offerable facts, of all checkpoints, per run mean. */
  evidenceShare: number | null
  /** Safeguard firings per run, averaged. */
  safeguards: Record<string, number>
  costPerStoryUsd: number | null
  costPerOverviewUsd: number | null
  recentering: ReplayRecenterScore
}

export interface ReplayRecenterScore {
  /** No re-center of an overview whose development's key has no center, and no near miss joined by one (shares pooled over runs). */
  bars: Bar[]
  /** Applied re-centers the bars score and splits per run, averaged; the most any one overview had in a run, of every re-center (never more than the limit). */
  applied: number | null
  /** Applied re-centers of an overview standing for a development the half's keys do not score (the background's): in no bar, per run, averaged. */
  unscored: number | null
  splits: number | null
  mostPerOverview: number
  /** Each re-center of a development whose key has a center: its day against the center's `from`. */
  timing: { run: number; key: string; day: string; from: string }[]
}

/** The overviews founded by two center entries of one key, neither a base entry of any key. Pure. */
export function splitsOf(keys: readonly AnswerKey[], overviews: readonly { id: string; foundedFrom: [string, string] }[]): string[] {
  const bases = new Set(keys.flatMap(k => k.entries.map(e => e.slug)))
  const centerKey = new Map(keys.flatMap(k => k.centers.flatMap(c => c.entries.filter(e => !bases.has(e.slug)).map(e => [e.slug, k.id] as const))))
  return overviews.filter(o => centerKey.has(o.foundedFrom[0]) && centerKey.get(o.foundedFrom[0]) === centerKey.get(o.foundedFrom[1])).map(o => o.id)
}

/**
 * The re-centers' bars and counts. A re-center of an overview standing for a development the half's
 * keys do not score (a background one) is no evidence on the half: it counts in neither bar and apart
 * from `applied`; one of an overview standing for no development is still a false one. The most per
 * overview is over every re-center, since the code's limit holds for all.
 */
export function scoreReplayRecenters(keys: readonly AnswerKey[], runs: readonly ReplayRunResult[]): ReplayRecenterScore {
  const from = new Map(keys.flatMap(k => (k.centers[0] ? [[k.id, k.centers[0].from] as const] : [])))
  const scored = new Set(keys.map(k => k.id))
  const perRun = runs.map(r => {
    const counts = new Map<string, number>()
    for (const x of r.recenters) counts.set(x.overviewId, (counts.get(x.overviewId) ?? 0) + 1)
    const judged = r.recenters.filter(x => x.development === null || scored.has(x.development))
    return {
      applied: judged.length,
      unscored: r.recenters.length - judged.length,
      wrong: judged.filter(x => x.development === null || !from.has(x.development)).length,
      nearMisses: judged.reduce((s, x) => s + x.nearMissesJoined.length, 0),
      joined: judged.reduce((s, x) => s + x.joined.length, 0),
      most: Math.max(0, ...counts.values()),
      splits: r.splits.length,
    }
  })
  return {
    bars: [
      // Shares pooled over the runs (10%, the owner's ruling of 2026-11-24; none until then); a replay with no re-center made no mistake
      shareBar('false re-centers', sum(perRun.map(p => p.wrong)), sum(perRun.map(p => p.applied)), RECENTER_MISTAKES_BAR, runs.length > 0),
      shareBar(
        // Of the stories the re-centers took in
        'near misses joined by a re-center',
        sum(perRun.map(p => p.nearMisses)),
        sum(perRun.map(p => p.joined)),
        RECENTER_MISTAKES_BAR,
        runs.length > 0,
      ),
    ],
    applied: mean(perRun.map(p => p.applied)),
    unscored: mean(perRun.map(p => p.unscored)),
    splits: mean(perRun.map(p => p.splits)),
    mostPerOverview: Math.max(0, ...perRun.map(p => p.most)),
    timing: runs.flatMap(r =>
      r.recenters.flatMap(x =>
        x.development && from.has(x.development) ? [{ run: r.run, key: x.development, day: x.day, from: from.get(x.development)! }] : [],
      ),
    ),
  }
}

/** The bars over every run, and the replay's figures; `others`, the keys outside the half, are never scored: they say what an overview stands for and what a background story is (`linkKeys`). */
export function scoreReplay(
  keys: readonly AnswerKey[],
  runs: readonly ReplayRunResult[],
  minStandsFacts: number,
  stories: number,
  others: readonly AnswerKey[] = [],
): ReplayScore {
  const names = [...new Set(runs.flatMap(r => Object.keys(r.safeguards)))].sort()
  const totalUsd = runs.reduce((s, r) => s + r.costUsd, 0)
  const founded = runs.reduce((s, r) => s + r.founded, 0)
  return {
    link: scoreLinking(keys, runs, new Map(), others),
    evidenceShare: mean(runs.map(r => ratio(r.checkpoints.filter(c => c.offerable >= minStandsFacts).length, r.checkpoints.length))),
    safeguards: Object.fromEntries(names.map(n => [n, runs.reduce((s, r) => s + (r.safeguards[n] ?? 0), 0) / Math.max(1, runs.length)])),
    costPerStoryUsd: stories === 0 || runs.length === 0 ? null : totalUsd / (stories * runs.length),
    costPerOverviewUsd: founded === 0 ? null : totalUsd / founded,
    recentering: scoreReplayRecenters(keys, runs),
  }
}
