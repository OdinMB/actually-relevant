/**
 * The overview linking bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored
 * on the sandbox's replay of a half's developments (`link.ts`). Each replayed overview stands for the
 * development most of its members are `must` entries of. `link`: precision over `must` entries and
 * near misses that ended in an overview (`optional` entries ignored; a near miss in its development's
 * overview, or an entry in another's, is wrong), and recall of `must` entries. `found`: foundings whose
 * pair is not two entries of one development, and whether each development's founded charter names the
 * key's end event (the strong judge's verdicts, passed in). `role`: turning point or routine against
 * the key. Means over runs. Pure.
 */
import type { Role } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'

/** One replay's end state: each overview's members and founding pair, and each story's stored role. */
export interface ReplayRun {
  run: number
  overviews: { id: string; members: string[]; foundedFrom: [string, string]; endEvent: string }[]
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
}

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
  /** Roles agreeing with the key, of must entries with a stored role. */
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

/** Which development each slug is a must or optional entry of, and which it is a near miss of. */
export function keyIndex(keys: readonly AnswerKey[]) {
  const entry = new Map<string, { key: string; join: 'must' | 'optional'; role: Role['role'] }>()
  const nearMiss = new Map<string, string[]>()
  for (const k of keys) {
    for (const e of k.entries) entry.set(e.slug, { key: k.id, join: e.join, role: e.role })
    for (const n of k.nearMisses) nearMiss.set(n.slug, [...(nearMiss.get(n.slug) ?? []), k.id])
  }
  return { entry, nearMiss }
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

/** One run against the keys. */
export function scoreLinkRun(keys: readonly AnswerKey[], run: ReplayRun): LinkRunScore {
  const { entry, nearMiss } = keyIndex(keys)
  const placed = new Map<string, string | null>() // slug → its overview's development
  const developments = new Map<string, string>()
  const mistakes: string[] = []
  let wrongFoundings = 0
  for (const o of run.overviews) {
    const dev = developmentOf(o.members, entry)
    if (dev && !developments.has(dev)) developments.set(dev, o.id)
    for (const m of o.members) placed.set(m, dev)
    const [a, b] = o.foundedFrom.map(s => entry.get(s))
    if (!a || !b || a.key !== b.key) {
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
  const judged = musts.filter(([slug]) => run.roles.has(slug))
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
 * The bars over every run: joins right ≥97% and must entries found ≥85% (`link`); no wrong founding,
 * and the right end event for every development (`found`, from `endEventRight`: development id → the
 * judge's verdict per run, null where it had no overview); roles agreeing ≥85% (`role`).
 */
export function scoreLinking(
  keys: readonly AnswerKey[],
  runs: readonly ReplayRun[],
  endEventRight: ReadonlyMap<string, (boolean | null)[]> = new Map(),
): LinkScore {
  const scored = runs.map(r => scoreLinkRun(keys, r))
  const verdicts = keys.map(k => endEventRight.get(k.id) ?? [])
  const everyRun = verdicts.length === 0 ? null : mean(runs.map((_, i) => (verdicts.every(v => v[i] === true) ? 1 : 0)))
  return {
    runs: scored,
    link: [
      bar('joins right', mean(scored.map(s => ratio(s.right, s.right + s.wrong))), 0.97),
      bar('true joins found', mean(scored.map(s => ratio(s.found, s.must))), 0.85),
    ],
    found: [
      bar('wrong foundings', mean(scored.map(s => s.wrongFoundings)), 0, 'atMost'),
      bar('right end event for every development', runs.length === 0 ? null : everyRun, 1),
    ],
    role: [bar('roles agreeing', mean(scored.map(s => ratio(s.rolesAgreeing, s.rolesJudged))), 0.85)],
  }
}
