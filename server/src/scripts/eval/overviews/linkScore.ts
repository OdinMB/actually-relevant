/**
 * The overview linking bars (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"), scored
 * on the sandbox's replay of a half's developments (`link.ts`), with one reading of the keys that the
 * diagnostics and the whole-step replay share (`linkKeys`, ADR-0073). Each replayed overview stands for
 * the development, of any key, most of its members are `must` entries of. `link`: joins right, where
 * every member of a judged development's overview is scored (its own `must` entries right, its
 * `optional` and center entries ignored, every other member wrong: a near miss, another key's entry, a
 * background story) and, in any other overview, only the half's `must` entries (right where that
 * overview's key holds one as `must` too); and recall of the half's `must` entries. `found`: the share
 * of foundings with a story of the half that are wrong, pooled over runs: a pair not two entries of one
 * development (of any key), or a repeat of a development whose overview is still open; and founded
 * charters naming an end event other than the key's (the strong judge's verdicts, passed in; one naming
 * none is never wrong). `role`: turning point or routine against the key of the overview a `must` entry
 * was found in, any answer agreeing with an entry that accepts either (`eitherRole`), counted apart so
 * the bar's meaning stays visible. Means over runs. Each wrong join and wrong founding is kept in words
 * for the report, its stories by title and as the keys make them out (`linkKeys`' `named`), the overview
 * by its title. And how often the link calls flagged the re-center signals (`scoreSignals`), with no
 * bar. Pure.
 */
import type { Role } from '../../../services/overviewTypes.js'
import { isLabelDevelopment } from './developmentHalves.js'
import type { AnswerKey } from './keySchema.js'

/**
 * One replay's end state: each overview's members and founding pair, in the order founded (the
 * sandbox's), and each story's stored role. Its title and founding day, where known, only name it in
 * the report.
 */
export interface ReplayRun {
  run: number
  overviews: { id: string; members: string[]; foundedFrom: [string, string]; endEvent: string | null; title?: string; foundedOn?: string }[]
  /** Each replayed story's role (from its join, its founding, or the link answer for a story left alone), by slug. */
  roles: Map<string, Role>
}

export interface Bar {
  name: string
  value: number | null
  target: number
  /** `atMost`: the value may not exceed the target (a count of wrong ones, or a share where `share` is set). */
  direction: 'atLeast' | 'atMost'
  /** An `atMost` bar on a share rather than a count: the report shows it as a percentage. */
  share?: boolean
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
  /** Every overview founded, and those with a story of the half in their pair: only these are judged. */
  foundings: number
  judgedFoundings: number
  /** Judged foundings whose pair is not two entries of one development. */
  wrongFoundings: number
  /** Judged foundings of a development that already had an open overview in the run (`scoreLinkRun`). */
  repeatFoundings: number
  /** Judged foundings wrong either way, each once: the share's numerator. */
  foundingsWrong: number
  /** Repeats founded from two background stories: unscored, listed for the owner. */
  backgroundRepeats: string[]
  /** Roles agreeing with the key, of must entries found in an overview whose key holds them as must. */
  rolesAgreeing: number
  rolesJudged: number
  /** The judged entries that accept either role (`eitherRole`): agreeing whatever role was given. */
  rolesEither: number
  /** The half's development id → its overview's id in this run, for the end-event judge. */
  developments: Map<string, string>
  /**
   * Each wrong founding and wrong join in words, for the report: the stories by title and as the keys
   * make them out (`named`), the overview by its title (its id and founding day for a founding), with
   * the development it stands for.
   */
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

/**
 * The end-event bar, report only (the owner, 2026-11-24): an end event only marks a turning point and
 * never closes an overview (ADR-0072), so a wrong one is listed for the owner and never blocks the gate.
 */
export const END_EVENT_REPORT_ONLY = 'report only: an end event only marks a turning point'
/** How often a role must agree with the key (the owner's, 2026-11-23: getting roles right matters less); the `role` bar, and the review's bar on the roles it leaves. */
export const ROLES_AGREEING_BAR = 0.65

/**
 * A bar on a share of mistakes (the owner, 2026-11-24, in place of "none"): `hit` of `of`, at most
 * `target`. With nothing to judge it has no data, unless `emptyIsNone`: then nothing done is no mistake.
 */
export const shareBar = (name: string, hit: number, of: number, target: number, emptyIsNone = false): Bar => ({
  ...bar(name, of === 0 && emptyIsNone ? 0 : ratio(hit, of), target, 'atMost'),
  share: true,
})
/** Mistakes a re-center may make, as a share (false re-centers, near misses joined, drafts off the anchor), and unsupported lines a stands may hold. */
export const RECENTER_MISTAKES_BAR = 0.1
export const UNSUPPORTED_LINES_BAR = 0.05

export const reportOnly = (b: Bar, why: string): Bar => ({ ...b, met: null, forOwner: why })

/** A rate's bar from the judgments behind it (all runs together): below `MIN_RATE_SAMPLE` it is reported for the owner, not decided. */
export function rateBar(name: string, value: number | null, target: number, judgments: number, direction: Bar['direction'] = 'atLeast'): Bar {
  const b = bar(name, value, target, direction)
  if (value === null || judgments >= MIN_RATE_SAMPLE) return b
  return { ...b, met: null, forOwner: `${judgments} judgment${judgments === 1 ? '' : 's'}, fewer than the ${MIN_RATE_SAMPLE} an automatic verdict needs` }
}

/** An entry's role as the role bars read it: `either` for one that accepts both (`eitherRole`). */
export type KeyRole = Role['role'] | 'either'

/** A key entry's role for the bars: `either` when it accepts both, else its role. */
export const keyRoleOf = (e: Pick<AnswerKey['entries'][number], 'role' | 'eitherRole'>): KeyRole => (e.eitherRole ? 'either' : e.role)

/** Whether a given role agrees with the key's: any answer agrees with an entry that accepts either. */
export const roleAgrees = (expected: KeyRole, given: Role['role']): boolean => expected === 'either' || expected === given

/** What the keys make of one entry story (`keyIndex`). */
export interface IndexedEntry {
  /** Its first must key, or with none the key of its last optional entry. */
  key: string
  /** `must` when any key holds it as must: a must outweighs another key's optional. */
  join: 'must' | 'optional'
  /** Its role in `key`. */
  role: KeyRole
  /**
   * Every key it is a must entry of, with its role there. A story may be a must of two developments
   * (a deal that ends a war and reopens a strait); joining either one's overview is right, and its
   * role is judged against the key of the overview it joined.
   */
  musts: ReadonlyMap<string, KeyRole>
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
  const musts = new Map<string, Map<string, KeyRole>>()
  const optional = new Map<string, Map<string, KeyRole>>()
  const add = (to: typeof musts, slug: string, key: string, role: KeyRole) => to.set(slug, (to.get(slug) ?? new Map()).set(key, role))
  const nearMiss = new Map<string, string[]>()
  for (const k of keys) {
    for (const e of k.entries) add(e.join === 'must' ? musts : optional, e.slug, k.id, keyRoleOf(e))
    for (const n of [...k.nearMisses, ...k.centers.flatMap(c => c.nearMisses)]) nearMiss.set(n.slug, [...new Set([...(nearMiss.get(n.slug) ?? []), k.id])])
  }
  const entry = new Map<string, IndexedEntry>()
  for (const slug of new Set([...musts.keys(), ...optional.keys()])) {
    const m = musts.get(slug) ?? new Map<string, KeyRole>()
    const o = optional.get(slug) ?? new Map<string, KeyRole>()
    const [key, role] = m.size > 0 ? [...m][0]! : [...o].at(-1)!
    entry.set(slug, { key, join: m.size > 0 ? 'must' : 'optional', role, musts: m, optionalIn: new Set(o.keys()) })
  }
  for (const k of keys)
    for (const e of k.centers.flatMap(c => c.entries))
      if (!entry.has(e.slug)) entry.set(e.slug, { key: k.id, join: 'optional', role: keyRoleOf(e), musts: new Map(), optionalIn: new Set([k.id]) })
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
 * - `as(slug)`: what the keys make of a story, the one wording the bars' mistakes, the diagnostics and
 *   the reports share: the half's entry it is (a center's reads as optional, as `keyIndex` files it),
 *   the half's near miss, and the outside keys it is an entry of, a label key marked as one
 *   (`background:` when the half names nothing of it); `in no key` with none. `named(slug)`: the story
 *   by the first title any key gives it, with its slug and `as`; by its slug alone when no key titles it.
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
  const as = (slug: string): string => {
    const e = entry.get(slug)
    const near = nearMiss.get(slug) ?? []
    const parts = [
      ...(e ? [e.join === 'must' ? `must entry of ${[...e.musts.keys()].join(' or ')}` : `optional entry of ${e.key}`] : []),
      ...(near.length > 0 ? [`near miss of ${near.join(', ')}`] : []),
    ]
    const outside = [...(entryKeys.get(slug) ?? [])].filter(id => !scored.has(id)).map(id => (isLabelDevelopment(id) ? `${id} (label key)` : id))
    // A story the half's keys name nothing of is only there as background
    if (outside.length > 0) parts.push(`${parts.length > 0 ? '' : 'background: '}entry of ${outside.join(', ')}`)
    return parts.join('; ') || 'in no key'
  }
  const titles = new Map<string, string>()
  for (const x of every.flatMap(k => [...k.entries, ...k.nearMisses, ...k.centers.flatMap(c => [...c.entries, ...c.nearMisses])]))
    if (x.title && !titles.has(x.slug)) titles.set(x.slug, x.title)
  const named = (slug: string): string => {
    const title = titles.get(slug)
    return title ? `"${title}" (${slug}; ${as(slug)})` : `${slug} (${as(slug)})`
  }
  return { entry, nearMiss, all, entryKeys, scored, judged, standsFor, verdict, as, named }
}
export type LinkKeys = ReturnType<typeof linkKeys>

/** An overview as the reports name it: its title and the development it stands for. */
export const overviewTitled = (title: string, dev: string | null): string => `"${title}" (${dev ?? 'no development'})`

/** What a wrong join was, for the report: the story by its title and as the keys make it out (`named`), and the overview it joined by its title and development. */
function wrongJoin(k: LinkKeys, slug: string, where: { dev: string | null; title?: string | undefined }): string {
  return `${k.named(slug)} joined ${where.title ? overviewTitled(where.title, where.dev) : (where.dev ?? 'an overview of no development')}`
}

/** An earlier overview as a repeat line names it: its title and id, when and from which stories (by slug) it was founded. */
const foundedAs = (o: ReplayRun['overviews'][number]): string => {
  const founded = `founded ${o.foundedOn ? `${o.foundedOn} ` : ''}from ${o.foundedFrom[0]} and ${o.foundedFrom[1]}`
  return o.title ? `"${o.title}" (${o.id}, ${founded})` : `${o.id} (${founded})`
}

/** A repeat founding in words: the development, the founding with its two stories by name (`named`), and the earlier overviews of it it repeats. */
function repeatLine(k: LinkKeys, dev: string, o: ReplayRun['overviews'][number], earlier: readonly ReplayRun['overviews'][number][]): string {
  const [a, b] = o.foundedFrom
  const which = o.title ? `"${o.title}", ${o.id}` : o.id
  return `founded ${dev} again from ${k.named(a)} and ${k.named(b)}${o.foundedOn ? ` on ${o.foundedOn}` : ''} (${which}), repeating ${earlier.map(foundedAs).join(' and ')}`
}

/**
 * One run against the keys (`linkKeys`). A founding is judged only when its pair holds a story of the
 * half: two background stories are not the half's to judge. A judged founding is wrong when its pair
 * is not two entries of one development, of any key (two entries of a development the half does not
 * score, two of the strait's stories in the judged half, still found it rightly), or when it is a
 * **repeat**: the development it stands for (`standsFor`) already had an overview founded earlier in
 * the run that is still open, where joining that one was the right move (the owner, 2026-11-23). No
 * editor acts in a replay, so no overview is closed by one, and one that faded can still be joined
 * again: every earlier overview of the development counts as open. A founding wrong both ways counts
 * once; a repeat of two background stories is listed (`backgroundRepeats`), never scored. Roles are
 * judged only on must entries found in an overview whose key holds them as must: a role is an
 * entry's, so a story left alone has none to judge.
 */
export function scoreLinkRun(keys: readonly AnswerKey[], run: ReplayRun, others: readonly AnswerKey[] = []): LinkRunScore {
  const k = linkKeys(keys, others)
  const placed = new Map<string, { dev: string | null; title?: string | undefined }>() // slug → its overview's development and title
  const developments = new Map<string, string>()
  const opened = new Map<string, ReplayRun['overviews']>() // development → its overviews founded so far, all still open
  const mistakes: string[] = []
  const backgroundRepeats: string[] = []
  let [judgedFoundings, wrongFoundings, repeatFoundings, foundingsWrong] = [0, 0, 0, 0]
  for (const o of run.overviews) {
    const dev = k.standsFor(o.members)
    if (dev && k.scored.has(dev) && !developments.has(dev)) developments.set(dev, o.id)
    for (const m of o.members) placed.set(m, { dev, title: o.title })
    const [a, b] = o.foundedFrom
    const earlier = dev ? (opened.get(dev) ?? []) : []
    if (dev) opened.set(dev, [...earlier, o])
    const repeat = dev !== null && earlier.length > 0 ? repeatLine(k, dev, o, earlier) : null
    if (!k.judged(a) && !k.judged(b)) {
      if (repeat) backgroundRepeats.push(repeat)
      continue
    }
    judgedFoundings++
    const notOne = !oneDevelopment(k.entryKeys, a, b)
    if (notOne) {
      wrongFoundings++
      mistakes.push(
        `${o.title ? `"${o.title}" (${o.id}) ` : ''}founded${o.foundedOn ? ` on ${o.foundedOn}` : ''} from ${k.named(a)} and ${k.named(b)}, not two entries of one development`,
      )
    }
    if (repeat) {
      repeatFoundings++
      mistakes.push(repeat)
    }
    if (notOne || repeat) foundingsWrong++
  }
  let right = 0
  let wrong = 0
  for (const [slug, where] of placed) {
    const v = k.verdict(slug, where.dev)
    if (v === 'right') right++
    else if (v === 'wrong') {
      wrong++
      mistakes.push(wrongJoin(k, slug, where))
    }
  }
  const musts = [...k.entry].filter(([, e]) => e.join === 'must').map(([slug]) => slug)
  /** The role the key of the overview a must entry joined gives it; undefined when that key does not hold it as must. */
  const roleWhere = (slug: string) => k.all.get(slug)?.musts.get(placed.get(slug)?.dev ?? '')
  const found = musts.filter(slug => roleWhere(slug) !== undefined)
  const judged = found.filter(slug => run.roles.has(slug))
  return {
    run: run.run,
    right,
    wrong,
    found: found.length,
    must: musts.length,
    foundings: run.overviews.length,
    judgedFoundings,
    wrongFoundings,
    repeatFoundings,
    foundingsWrong,
    backgroundRepeats,
    rolesAgreeing: judged.filter(slug => roleAgrees(roleWhere(slug)!, run.roles.get(slug)!.role)).length,
    rolesJudged: judged.length,
    rolesEither: judged.filter(slug => roleWhere(slug) === 'either').length,
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
 * The most of the judged foundings that may be wrong (not one development, or a repeat), pooled over
 * the runs: the owner, 2026-11-23, "1 incorrect in 10 might be OK for now. 1 in 4 is not." Until then
 * the bar was no wrong founding, a count, and repeats went uncounted.
 */
export const WRONG_FOUNDINGS_BAR = 0.1

/**
 * The bars over every run: joins right ≥97% and must entries found ≥85% (`link`); wrong foundings at
 * most `WRONG_FOUNDINGS_BAR` of the judged ones, and no wrong end event, judged only where a founding
 * names one (`found`, from `endEvents`: development id → its verdict per run; no verdict while a named
 * one is unjudged); roles agreeing ≥65% (`role`; the owner lowered it from 85% on 2026-11-23: getting
 * roles right matters less). Means over runs, but the foundings' share is pooled: a run founds about
 * ten judged overviews, so one founding moves a run's share by about 10 points, and pooling weighs
 * every founding the same, as the owner's "1 in 10" reads.
 */
export function scoreLinking(
  keys: readonly AnswerKey[],
  runs: readonly ReplayRun[],
  endEvents: ReadonlyMap<string, EndEventVerdict[]> = new Map(),
  others: readonly AnswerKey[] = [],
): LinkScore {
  const scored = runs.map(r => scoreLinkRun(keys, r, others))
  const sum = (of: (s: LinkRunScore) => number) => scored.reduce((n, s) => n + of(s), 0)
  const verdicts = keys.map(k => endEvents.get(k.id) ?? [])
  const unjudged = verdicts.some(v => v.includes('unjudged'))
  const wrongEnds = runs.length === 0 || unjudged ? null : mean(runs.map((_, i) => verdicts.filter(v => v[i] === 'wrong').length))
  return {
    runs: scored,
    link: [
      bar('joins right', mean(scored.map(s => ratio(s.right, s.right + s.wrong))), 0.97),
      bar('true joins found', mean(scored.map(s => ratio(s.found, s.must))), 0.85),
    ],
    found: [
      {
        ...bar(
          'wrong foundings (share)',
          ratio(
            sum(s => s.foundingsWrong),
            sum(s => s.judgedFoundings),
          ),
          WRONG_FOUNDINGS_BAR,
          'atMost',
        ),
        share: true,
      },
      reportOnly(bar('wrong end events (where one is named)', wrongEnds, 0, 'atMost'), END_EVENT_REPORT_ONLY),
    ],
    role: [bar('roles agreeing', mean(scored.map(s => ratio(s.rolesAgreeing, s.rolesJudged))), ROLES_AGREEING_BAR)],
  }
}
