/**
 * The overview linking bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored
 * on the sandbox's replay of a half's developments (`link.ts`). Each replayed overview stands for the
 * development most of its members are `must` entries of. `link`: precision over `must` entries and
 * near misses that ended in an overview (`optional` entries ignored; a near miss in its development's
 * overview, or an entry in another's, is wrong), and recall of `must` entries. `found`: foundings whose
 * pair is not two entries of one development (of any key, the other half's too), and founded charters
 * naming an end event other than the key's (the strong judge's verdicts, passed in; one naming none is
 * never wrong). `role`: turning point or routine against the key, over the must entries found in their
 * development's overview. Means over runs. And how often the link calls flagged the re-center signals
 * (`scoreSignals`), with no bar. Pure.
 */
import type { Role } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'

/** One replay's end state: each overview's members and founding pair, and each story's stored role. */
export interface ReplayRun {
  run: number
  overviews: { id: string; members: string[]; foundedFrom: [string, string]; endEvent: string | null }[]
  /** Each replayed story's role (from its join, its founding, or the link answer for a story left alone), by slug. */
  roles: Map<string, Role>
}

export interface Bar {
  name: string
  value: number | null
  target: number
  /** `atMost`: the value may not exceed the target (a count of wrong ones). */
  direction: 'atLeast' | 'atMost'
  met: boolean | null
  /** Set when a rate rests on too few judgments to decide: the value is reported, `met` is null, and the owner reads the list and decides. */
  forOwner?: string
}

/**
 * Judgments a rate needs, over all its runs, before it decides on its own: with 20, one judgment
 * moves the rate by at most 5 points. Below it the rate is reported for the owner to read.
 */
export const MIN_RATE_SAMPLE = 20

export interface LinkRunScore {
  run: number
  /** Joins right and wrong, over must entries and near misses in an overview. */
  right: number
  wrong: number
  /** Must entries in their development's overview, of all must entries. */
  found: number
  must: number
  foundings: number
  wrongFoundings: number
  /** Roles agreeing with the key, of must entries found in their development's overview. */
  rolesAgreeing: number
  rolesJudged: number
  /** Development id → its overview's id in this run, for the end-event judge. */
  developments: Map<string, string>
  /** What each wrong join was, for the report. */
  mistakes: string[]
}

export const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b)
export const mean = (values: (number | null)[]): number | null => {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((s, v) => s + v, 0) / known.length
}
export const bar = (name: string, value: number | null, target: number, direction: Bar['direction'] = 'atLeast'): Bar => ({
  name,
  value,
  target,
  direction,
  met: value === null ? null : direction === 'atLeast' ? value >= target : value <= target,
})

/** A rate's bar from the judgments behind it (all runs together): below `MIN_RATE_SAMPLE` it is reported for the owner, not decided. */
export function rateBar(name: string, value: number | null, target: number, judgments: number, direction: Bar['direction'] = 'atLeast'): Bar {
  const b = bar(name, value, target, direction)
  if (value === null || judgments >= MIN_RATE_SAMPLE) return b
  return { ...b, met: null, forOwner: `${judgments} judgment${judgments === 1 ? '' : 's'}, fewer than the ${MIN_RATE_SAMPLE} an automatic verdict needs` }
}

/**
 * Which development each slug is a must or optional entry of, and which it is a near miss of. A
 * center's entries count as `optional` entries of its key, so the linking bars skip them, and a base
 * entry of any key takes precedence over them; a center's near misses are its key's near misses.
 */
export function keyIndex(keys: readonly AnswerKey[]) {
  const entry = new Map<string, { key: string; join: 'must' | 'optional'; role: Role['role'] }>()
  const nearMiss = new Map<string, string[]>()
  for (const k of keys) {
    for (const e of k.entries) entry.set(e.slug, { key: k.id, join: e.join, role: e.role })
    for (const n of [...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)]) nearMiss.set(n.slug, [...new Set([...(nearMiss.get(n.slug) ?? []), k.id])])
  }
  for (const k of keys)
    for (const e of k.centers.flatMap(c => c.entries)) if (!entry.has(e.slug)) entry.set(e.slug, { key: k.id, join: 'optional', role: e.role })
  return { entry, nearMiss }
}

/** A re-center signal a link decision kept (`linkInputs.signals`), by the story's slug. */
export interface StorySignal {
  slug: string
  overviewId: string
  kind: 'wider' | 'center_moved'
}

/** How often one run's link calls flagged the re-center signals (plan "Evals": no bars; the owner reads them). */
export interface SignalRunScore {
  run: number
  /** Reviewed centers' entries replayed, and those flagged (wider or center moved) for their development's overview: the signal's recall. */
  centerEntries: number
  centerFlagged: number
  /** Base near misses replayed, and those flagged wider for any overview: how often attempts would fire, and so their cost. */
  nearMisses: number
  nearMissesWider: number
  /** Stories of developments whose key has no center, flagged center moved: false shift signals. */
  falseShifts: string[]
}

/** One run's signals against the keys (`developments`: development id → its overview in the run). */
export function scoreSignals(
  keys: readonly AnswerKey[],
  replayed: ReadonlySet<string>,
  signals: readonly StorySignal[],
  developments: ReadonlyMap<string, string>,
  run: number,
): SignalRunScore {
  const bases = new Set(keys.flatMap(k => k.entries.map(e => e.slug)))
  const of = (slug: string) => signals.filter(s => s.slug === slug)
  const centers = keys.flatMap(k =>
    k.centers.flatMap(c => c.entries.filter(e => replayed.has(e.slug) && !bases.has(e.slug)).map(e => ({ slug: e.slug, key: k.id }))),
  )
  const nearMisses = [...new Set(keys.flatMap(k => k.nearMisses.map(n => n.slug)))].filter(s => replayed.has(s) && !bases.has(s))
  const unmoved = keys.filter(k => k.centers.length === 0).flatMap(k => [...k.entries.map(e => e.slug), ...k.nearMisses.map(n => n.slug)])
  return {
    run,
    centerEntries: centers.length,
    centerFlagged: centers.filter(c => of(c.slug).some(s => s.overviewId === developments.get(c.key))).length,
    nearMisses: nearMisses.length,
    nearMissesWider: nearMisses.filter(slug => of(slug).some(s => s.kind === 'wider')).length,
    falseShifts: [...new Set(unmoved)].filter(slug => replayed.has(slug) && of(slug).some(s => s.kind === 'center_moved')),
  }
}

/** The development an overview stands for: the key most of its members are must entries of (ties to the first founded member's key); null with none. */
export function developmentOf(members: readonly string[], entry: ReturnType<typeof keyIndex>['entry']): string | null {
  const counts = new Map<string, number>()
  for (const m of members) {
    const e = entry.get(m)
    if (e?.join === 'must') counts.set(e.key, (counts.get(e.key) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [key, n] of counts) if (best === null || n > counts.get(best)!) best = key
  return best
}

/**
 * Every key each slug is an entry of (must or optional, its centers' entries too), over the keys
 * given: a story may be an entry of two keys (a deal story of Lebanon's and of the strait's).
 */
export function entryKeysOf(keys: readonly AnswerKey[]): Map<string, Set<string>> {
  const of = new Map<string, Set<string>>()
  for (const k of keys) for (const e of [...k.entries, ...k.centers.flatMap(c => c.entries)]) of.set(e.slug, new Set([...(of.get(e.slug) ?? []), k.id]))
  return of
}

/** Whether two stories are entries of one development: of one key among `entryKeys` (`entryKeysOf`). */
export const oneDevelopment = (entryKeys: ReadonlyMap<string, ReadonlySet<string>>, a: string, b: string): boolean =>
  [...(entryKeys.get(a) ?? [])].some(k => entryKeys.get(b)?.has(k) ?? false)

/**
 * One run against the keys. A founding is right when its pair are two entries of one development,
 * judged over the half's keys and `others` (the keys of the other half): two entries of a development
 * the half does not score (two of the strait's stories in the judged half) still found it rightly.
 * Roles are judged only on must entries found in their development's overview: a role is an entry's,
 * so a story left alone has none to judge.
 */
export function scoreLinkRun(keys: readonly AnswerKey[], run: ReplayRun, others: readonly AnswerKey[] = []): LinkRunScore {
  const { entry, nearMiss } = keyIndex(keys)
  const entryKeys = entryKeysOf([...keys, ...others])
  const placed = new Map<string, string | null>() // slug → its overview's development
  const developments = new Map<string, string>()
  const mistakes: string[] = []
  let wrongFoundings = 0
  for (const o of run.overviews) {
    const dev = developmentOf(o.members, entry)
    if (dev && !developments.has(dev)) developments.set(dev, o.id)
    for (const m of o.members) placed.set(m, dev)
    if (!oneDevelopment(entryKeys, o.foundedFrom[0], o.foundedFrom[1])) {
      wrongFoundings++
      mistakes.push(`founded from ${o.foundedFrom.join(' and ')}, not two entries of one development`)
    }
  }
  let right = 0
  let wrong = 0
  for (const [slug, dev] of placed) {
    const e = entry.get(slug)
    if (e?.join === 'optional') continue
    if (e?.join === 'must') {
      if (dev === e.key) right++
      else {
        wrong++
        mistakes.push(`${slug} (${e.key}) joined ${dev ?? 'an overview of no development'}`)
      }
    } else if (dev !== null && (nearMiss.get(slug) ?? []).includes(dev)) {
      wrong++
      mistakes.push(`near miss ${slug} joined ${dev}`)
    }
  }
  const musts = [...entry].filter(([, e]) => e.join === 'must')
  const found = musts.filter(([slug, e]) => placed.get(slug) === e.key).length
  const judged = musts.filter(([slug, e]) => placed.get(slug) === e.key && run.roles.has(slug))
  return {
    run: run.run,
    right,
    wrong,
    found,
    must: musts.length,
    foundings: run.overviews.length,
    wrongFoundings,
    rolesAgreeing: judged.filter(([slug, e]) => run.roles.get(slug)!.role === e.role).length,
    rolesJudged: judged.length,
    developments,
    mistakes,
  }
}

export interface LinkScore {
  runs: LinkRunScore[]
  link: Bar[]
  found: Bar[]
  role: Bar[]
}

/**
 * A development's founded end event in one run, as the strong judge read it: right or wrong against
 * the key's; `none` when its charter names none (most developments end by fading: counted for the
 * owner, never wrong); `unjudged` when it names one and the judge gave nothing; null when no overview
 * of it was founded (the joins' bars count that).
 */
export type EndEventVerdict = 'right' | 'wrong' | 'none' | 'unjudged' | null

/**
 * The bars over every run: joins right ≥97% and must entries found ≥85% (`link`); no wrong founding,
 * and no wrong end event, judged only where a founding names one (`found`, from `endEvents`:
 * development id → its verdict per run; no verdict while a named one is unjudged); roles agreeing ≥85%
 * (`role`).
 */
export function scoreLinking(
  keys: readonly AnswerKey[],
  runs: readonly ReplayRun[],
  endEvents: ReadonlyMap<string, EndEventVerdict[]> = new Map(),
  others: readonly AnswerKey[] = [],
): LinkScore {
  const scored = runs.map(r => scoreLinkRun(keys, r, others))
  const verdicts = keys.map(k => endEvents.get(k.id) ?? [])
  const unjudged = verdicts.some(v => v.includes('unjudged'))
  const wrongEnds = runs.length === 0 || unjudged ? null : mean(runs.map((_, i) => verdicts.filter(v => v[i] === 'wrong').length))
  return {
    runs: scored,
    link: [
      bar('joins right', mean(scored.map(s => ratio(s.right, s.right + s.wrong))), 0.97),
      bar('true joins found', mean(scored.map(s => ratio(s.found, s.must))), 0.85),
    ],
    found: [bar('wrong foundings', mean(scored.map(s => s.wrongFoundings)), 0, 'atMost'), bar('wrong end events (where one is named)', wrongEnds, 0, 'atMost')],
    role: [bar('roles agreeing', mean(scored.map(s => ratio(s.rolesAgreeing, s.rolesJudged))), 0.85)],
  }
}
