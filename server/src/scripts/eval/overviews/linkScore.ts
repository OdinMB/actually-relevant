/**
 * The overview linking bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored
 * on the sandbox's replay of a half's developments (`link.ts`), with one reading of the keys that the
 * diagnostics and the whole-step replay share (`linkKeys`, ADR-0073). Each replayed overview stands for
 * the development, of any key, most of its members are `must` entries of. `link`: joins right, where
 * every member of a judged development's overview is scored (its own `must` entries right, its
 * `optional` and center entries ignored, every other member wrong: a near miss, another key's entry, a
 * background story) and, in any other overview, only the half's `must` entries (right where that
 * overview's key holds one as `must` too); and recall of the half's `must` entries. `found`: foundings
 * with a story of the half whose pair is not two entries of one development (of any key), and founded
 * charters naming an end event other than the key's (the strong judge's verdicts, passed in; one naming
 * none is never wrong). `role`: turning point or routine against the key of the overview a `must` entry
 * was found in. Means over runs. And how often the link calls flagged the re-center signals
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
  /** Joins right and wrong, as `linkKeys`' `verdict` reads each member of an overview. */
  right: number
  wrong: number
  /** The half's must entries found in an overview whose key holds them as must, of all of them. */
  found: number
  must: number
  /** Every overview founded; the wrong ones only among those with a story of the half in their pair. */
  foundings: number
  wrongFoundings: number
  /** Roles agreeing with the key, of must entries found in an overview whose key holds them as must. */
  rolesAgreeing: number
  rolesJudged: number
  /** The half's development id → its overview's id in this run, for the end-event judge. */
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

/** What the keys make of one entry story (`keyIndex`). */
export interface IndexedEntry {
  /** Its first must key, or with none the key of its last optional entry. */
  key: string
  /** `must` when any key holds it as must: a must outweighs another key's optional. */
  join: 'must' | 'optional'
  /** Its role in `key`. */
  role: Role['role']
  /**
   * Every key it is a must entry of, with its role there. A story may be a must of two developments
   * (a deal that ends a war and reopens a strait); joining either one's overview is right, and its
   * role is judged against the key of the overview it joined.
   */
  musts: ReadonlyMap<string, Role['role']>
  /** The keys it is an optional entry of: joining one of their overviews is neither right nor wrong. */
  optionalIn: ReadonlySet<string>
}

/**
 * Which developments each slug is a must or optional entry of, and which it is a near miss of. A
 * center's entries count as `optional` entries of its key, so the linking bars ignore them in its
 * overview, and a base entry of any key takes precedence over them; a center's near misses are its
 * key's near misses.
 */
export function keyIndex(keys: readonly AnswerKey[]) {
  const musts = new Map<string, Map<string, Role['role']>>()
  const optional = new Map<string, Map<string, Role['role']>>()
  const add = (to: typeof musts, slug: string, key: string, role: Role['role']) => to.set(slug, (to.get(slug) ?? new Map()).set(key, role))
  const nearMiss = new Map<string, string[]>()
  for (const k of keys) {
    for (const e of k.entries) add(e.join === 'must' ? musts : optional, e.slug, k.id, e.role)
    for (const n of [...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)]) nearMiss.set(n.slug, [...new Set([...(nearMiss.get(n.slug) ?? []), k.id])])
  }
  const entry = new Map<string, IndexedEntry>()
  for (const slug of new Set([...musts.keys(), ...optional.keys()])) {
    const m = musts.get(slug) ?? new Map<string, Role['role']>()
    const o = optional.get(slug) ?? new Map<string, Role['role']>()
    const [key, role] = m.size > 0 ? [...m][0]! : [...o].at(-1)!
    entry.set(slug, { key, join: m.size > 0 ? 'must' : 'optional', role, musts: m, optionalIn: new Set(o.keys()) })
  }
  for (const k of keys)
    for (const e of k.centers.flatMap(c => c.entries))
      if (!entry.has(e.slug)) entry.set(e.slug, { key: k.id, join: 'optional', role: e.role, musts: new Map(), optionalIn: new Set([k.id]) })
  return { entry, nearMiss }
}

/** The stories that two or more keys hold as must entries, with those keys: the keys check lists them. */
export function sharedMusts(keys: readonly AnswerKey[]): { slug: string; keys: string[] }[] {
  return [...keyIndex(keys).entry].filter(([, e]) => e.musts.size > 1).map(([slug, e]) => ({ slug, keys: [...e.musts.keys()] }))
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

/**
 * The development an overview stands for: the key most of its members are must entries of (a must of
 * two keys counts for both; ties to the first founded member's key); null with none.
 */
export function developmentOf(members: readonly string[], entry: ReturnType<typeof keyIndex>['entry']): string | null {
  const counts = new Map<string, number>()
  for (const m of members) for (const key of entry.get(m)?.musts.keys() ?? []) counts.set(key, (counts.get(key) ?? 0) + 1)
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

/** A member's part in the joins bar: right, wrong, ignored (an optional join), or null where the bar does not score it. */
export type JoinVerdict = 'right' | 'wrong' | 'ignored' | null

/**
 * The one reading of the keys behind the linking bars, their diagnostics and the whole-step replay's
 * report (ADR-0073), so the three cannot drift. `keys` are the half's, the only ones scored; `others`
 * every other key (the other half's, the label keys), which only say what a story is.
 * - `entry`, `nearMiss`: the half's index (`keyIndex(keys)`); `all`: the entry index over every key;
 *   `entryKeys`: every key each slug is an entry of, centers' entries included.
 * - `judged(slug)`: a story of the half, an entry (a center's too) or a near miss: what `replaySlugs` replays.
 * - `standsFor(members)`: the development, of any key, an overview stands for (`developmentOf` over
 *   `all`): an overview of ten Iran-war stories and two Lebanon entries is the Iran war's, and the two
 *   Lebanon entries are its wrong joins.
 * - `verdict(slug, dev)`: in an overview standing for one of the half's developments, its `must`
 *   entries are right, its other entries (optional, a center's) ignored, and every other member wrong:
 *   the keys list every story that belongs. In any other overview only the half's `must` entries are
 *   scored: right where the overview's key holds one as `must` too, ignored as its other entry, wrong
 *   otherwise.
 */
export function linkKeys(keys: readonly AnswerKey[], others: readonly AnswerKey[] = []) {
  const { entry, nearMiss } = keyIndex(keys)
  const every = [...keys, ...others]
  const all = keyIndex(every).entry
  const entryKeys = entryKeysOf(every)
  const scored = new Set(keys.map(k => k.id))
  const judged = (slug: string): boolean => entry.has(slug) || nearMiss.has(slug)
  const standsFor = (members: readonly string[]): string | null => developmentOf(members, all)
  const inDevelopment = (slug: string, dev: string | null): Exclude<JoinVerdict, null> => {
    if (dev !== null && all.get(slug)?.musts.has(dev)) return 'right'
    return dev !== null && entryKeys.get(slug)?.has(dev) ? 'ignored' : 'wrong'
  }
  const verdict = (slug: string, dev: string | null): JoinVerdict => {
    if (dev !== null && scored.has(dev)) return inDevelopment(slug, dev)
    return entry.get(slug)?.join === 'must' ? inDevelopment(slug, dev) : null
  }
  return { entry, nearMiss, all, entryKeys, scored, judged, standsFor, verdict }
}
export type LinkKeys = ReturnType<typeof linkKeys>

/** What a wrong join was, for the report: the story as the keys make it out, and where it went. */
function wrongJoin(k: LinkKeys, slug: string, dev: string | null): string {
  const where = dev ?? 'an overview of no development'
  const e = k.entry.get(slug)
  if (e?.join === 'must') return `${slug} (${[...e.musts.keys()].join(' or ')}) joined ${where}`
  const near = k.nearMiss.get(slug) ?? []
  if (dev !== null && near.includes(dev)) return `near miss ${slug} joined ${dev}`
  if (e) return `${slug} (optional entry of ${e.key}) joined ${where}`
  if (near.length > 0) return `${slug} (near miss of ${near.join(', ')}) joined ${where}`
  const of = [...(k.entryKeys.get(slug) ?? [])]
  return `${slug} (${of.length > 0 ? `background: entry of ${of.join(', ')}` : 'in no key'}) joined ${where}`
}

/**
 * One run against the keys (`linkKeys`). A founding is right when its pair are two entries of one
 * development, of any key: two entries of a development the half does not score (two of the strait's
 * stories in the judged half) still found it rightly. A founding of two background stories is not the
 * half's to judge, so only a pair with a story of the half is checked. Roles are judged only on must
 * entries found in an overview whose key holds them as must: a role is an entry's, so a story left
 * alone has none to judge.
 */
export function scoreLinkRun(keys: readonly AnswerKey[], run: ReplayRun, others: readonly AnswerKey[] = []): LinkRunScore {
  const k = linkKeys(keys, others)
  const placed = new Map<string, string | null>() // slug → its overview's development
  const developments = new Map<string, string>()
  const mistakes: string[] = []
  let wrongFoundings = 0
  for (const o of run.overviews) {
    const dev = k.standsFor(o.members)
    if (dev && k.scored.has(dev) && !developments.has(dev)) developments.set(dev, o.id)
    for (const m of o.members) placed.set(m, dev)
    const [a, b] = o.foundedFrom
    if ((k.judged(a) || k.judged(b)) && !oneDevelopment(k.entryKeys, a, b)) {
      wrongFoundings++
      mistakes.push(`founded from ${a} and ${b}, not two entries of one development`)
    }
  }
  let right = 0
  let wrong = 0
  for (const [slug, dev] of placed) {
    const v = k.verdict(slug, dev)
    if (v === 'right') right++
    else if (v === 'wrong') {
      wrong++
      mistakes.push(wrongJoin(k, slug, dev))
    }
  }
  const musts = [...k.entry].filter(([, e]) => e.join === 'must').map(([slug]) => slug)
  /** The role the key of the overview a must entry joined gives it; undefined when that key does not hold it as must. */
  const roleWhere = (slug: string) => k.all.get(slug)?.musts.get(placed.get(slug) ?? '')
  const found = musts.filter(slug => roleWhere(slug) !== undefined)
  const judged = found.filter(slug => run.roles.has(slug))
  return {
    run: run.run,
    right,
    wrong,
    found: found.length,
    must: musts.length,
    foundings: run.overviews.length,
    wrongFoundings,
    rolesAgreeing: judged.filter(slug => run.roles.get(slug)!.role === roleWhere(slug)).length,
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
