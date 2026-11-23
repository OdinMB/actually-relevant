/**
 * The linking replay's diagnostics (`link.ts`; `.context/model-eval.md`, "Overview evals"): what lets a
 * rerun from the cache confirm why a bar failed. For each run: every must entry not found in its
 * development's overview, with why (not replayed, in another overview, no candidate, held for an
 * overview's re-center (ADR-0078), its development not offered, refused by code with the rule, the
 * founding not agreed, or the model's no or unsure with its confidence and scope; the link answer gives
 * no reason); the roles of found must entries that disagree with the key; every founded charter; and
 * the stories waiting for a re-center, with the partners their waits left out. The keys are read as the bars read them
 * (`linkKeys`): an overview stands for a development of any key, and a must entry is found in an
 * overview whose key holds it as must. No bars: the owner reads them. Pure.
 */
import { onlyPartnerSilent, type LinkResult } from '../../../services/overviewLink.js'
import type { Charter, FoundingOutcome, LinkOutcome, Role } from '../../../services/overviewTypes.js'
import { isLabelDevelopment } from './developmentHalves.js'
import type { AnswerKey } from './keySchema.js'
import { linkKeys, type KeyRole } from './linkScore.js'

/** A story's neighbours as the replay read them: production's (`read`, `near` of them within the distance) and those kept to the replayed stories. */
export interface NeighbourCount {
  read: number
  near: number
  kept: number
}

/** A candidate a link call was shown, and the model's answer for it. */
export interface CandidateTrace {
  ref: string
  /** The overview's id, or the partner story's slug. */
  id: string
  distance: number
  belongs: 'yes' | 'no' | 'unsure' | null
  confidence: number | null
  scope: 'inside' | 'wider' | 'unrelated' | null
  /** Why code refused a yes; null when it passed or was no yes. */
  refusal: string | null
  /** Set on the overview joined when a cause or place quote passed only by the near match (`quoteNearlyFound`). */
  nearMatch?: boolean
}

/** One story's last link attempt, by slug: what it was shown, what the model said, what code did, and what was stored. */
export interface StoryTrace {
  slug: string
  date: string
  /** The outcome stored for the story (a founding partner's `founded`), or null when nothing was stored. */
  outcome: LinkOutcome | null
  /** Whether a link answer came back. */
  called: boolean
  neighbours: NeighbourCount | null
  overviews: CandidateTrace[]
  partners: CandidateTrace[]
  /** A founding attempted from this story: the partner's slug, the outcome, why it did not found, and whether only the partner's lack of an occurrence refused it. */
  founding: { partner: string; outcome: FoundingOutcome; why: string | null; partnerSilent?: boolean } | null
  /** Earlier founding attempts refused only for their partner's lack of an occurrence, before the one above (ADR-0075); absent when none. */
  retried?: { partner: string; why: string | null }[]
  /** Neighbours left out as founding partners because a founding check judged them to report no occurrence; absent when none. */
  excluded?: string[]
  /** The overview whose refused yes kept a passing partner from founding (`LinkResult.foundingBlockedBy`); absent when none did. */
  blockedBy?: string
  /**
   * The overview whose re-center a `waiting` story waits for (ADR-0078), set only when `waiting` was what
   * was stored; absent when none (a replay saved before the rule reads as none). The diagnostics read it
   * only with a stored `waiting`, as a replay saved before that guard may carry it on another outcome.
   */
  heldForRecenter?: string
  /** Neighbours left out as founding partners because they waited for a re-center; absent when none. */
  heldPartners?: string[]
}

/**
 * The overview a story still waits for at the run's end: its `heldForRecenter` only when the outcome
 * stored is `waiting`. A `waiting` result whose write was skipped because a same-day story founded with
 * it first (stored `founded`), or that went stale twice (stored `conflict`), waits for nothing.
 */
const waitedFor = (t: StoryTrace): string | undefined => (t.outcome === 'waiting' ? t.heldForRecenter : undefined)

/** Why a founding attempt founded nothing, from its calls' answers. */
function foundingWhy(f: NonNullable<LinkResult['founding']>): string | null {
  if (f.outcome === 'founded') return null
  if (f.outcome === 'failed') return 'a founding call gave no answer'
  if (f.outcome === 'refused') return 'the draft had no title or IN, or broke a charter limit'
  const c = f.answers.check
  if (!c) return 'the check gave no answer'
  const parts = [
    ...(c.a.fits === 'no' ? [`A does not fit: ${c.a.reason}`] : []),
    ...(c.b.fits === 'no' ? [`B does not fit: ${c.b.reason}`] : []),
    ...(c.a.occurred === 'no' ? ['A reports no occurrence'] : []),
    ...(c.b.occurred === 'no' ? ['B reports no occurrence'] : []),
    ...(c.endEventConcrete === 'no' ? ['the end event is not concrete'] : []),
  ]
  return parts.join('; ') || 'the check did not agree'
}

/** A story's trace from its final link result, the outcome stored for it and its neighbour counts. */
export function traceOf(result: LinkResult, stored: LinkOutcome | null, neighbours: NeighbourCount | null, slug: (id: string) => string): StoryTrace {
  const answers = new Map((result.answer?.candidates ?? []).map(c => [c.id.trim(), c]))
  const refusals = new Map(result.refusals.map(r => [r.id, r.reason]))
  const candidate = (c: { ref: string; id: string; distance: number }, id: string): CandidateTrace => {
    const a = answers.get(c.ref)
    return {
      ref: c.ref,
      id,
      distance: c.distance,
      belongs: a?.belongs ?? null,
      confidence: a?.confidence ?? null,
      scope: a?.scope ?? null,
      refusal: refusals.get(c.ref) ?? null,
    }
  }
  const nearJoin = result.join?.nearMatch ? result.join.candidate.ref : null
  return {
    slug: slug(result.story.id),
    date: result.story.date,
    outcome: stored,
    called: result.answer !== null,
    neighbours,
    overviews: result.shown.overviews.map(o => ({ ...candidate(o, o.id), ...(o.ref === nearJoin ? { nearMatch: true } : {}) })),
    partners: result.shown.partners.map(p => candidate(p, slug(p.id))),
    founding: result.founding
      ? {
          partner: slug(result.founding.partner.id),
          outcome: result.founding.outcome,
          why: foundingWhy(result.founding),
          ...(onlyPartnerSilent(result.founding, result.story) ? { partnerSilent: true } : {}),
        }
      : null,
    ...(result.refusedFoundings.length > 0 ? { retried: result.refusedFoundings.map(f => ({ partner: slug(f.partner.id), why: foundingWhy(f) })) } : {}),
    ...(result.excludedPartners.length > 0 ? { excluded: result.excludedPartners.map(slug) } : {}),
    ...(result.foundingBlockedBy ? { blockedBy: result.foundingBlockedBy } : {}),
    // Only a wait that was stored: a `waiting` result founded by a same-day partner first, or stored as `conflict` after going stale twice, waits for nothing
    ...(result.heldForRecenter && stored === 'waiting' ? { heldForRecenter: result.heldForRecenter } : {}),
    ...(result.heldPartners.length > 0 ? { heldPartners: result.heldPartners.map(slug) } : {}),
  }
}

/** An overview the run founded, as the diagnostics show it. */
export interface FoundedOverview {
  id: string
  title: string
  charter: Charter
  /** The founding pair's slugs, the earlier first. */
  foundedFrom: [string, string]
  /** The day it was founded: the later founding story's. */
  foundedOn: string
  members: string[]
}

export const MISS_CAUSES = [
  'not replayed',
  'not linked',
  'in another overview',
  'no candidate',
  'held for a re-center',
  'not offered',
  'refused by code',
  'founding blocked',
  'founding refused: partner reported no occurrence',
  'founding not agreed',
  'model yes, not taken',
  'model unsure',
  'model no',
  'held',
  'failed',
  'conflict',
] as const
export type MissCause = (typeof MISS_CAUSES)[number]

export interface MissedEntry {
  slug: string
  key: string
  date: string
  cause: MissCause
  detail: string
}

export interface RoleMiss {
  slug: string
  key: string
  expected: Role['role']
  given: Role
}

export interface CharterLine {
  id: string
  title: string
  /** The development, of any key, it stands for (`linkKeys`' `standsFor`), or null. */
  development: string | null
  foundedOn: string
  /** Each founding story with what the keys make of it. */
  foundedFrom: { slug: string; as: string }[]
  /** Its members as the joins bar reads them (`linkKeys`' `verdict`): right, wrong, ignored (optional), and not scored. */
  members: { right: number; wrong: number; ignored: number; unscored: number }
  charter: Charter
}

export interface RunDiagnostics {
  run: number
  missed: MissedEntry[]
  /** Found must entries with a role, those that accept either role (never a miss), and those whose role disagrees with the key. */
  rolesJudged: number
  rolesEither: number
  roleMisses: RoleMiss[]
  charters: CharterLine[]
  /** The first overview of each development, of any key, by the day it was founded: when each development's overview began. */
  firstFoundings: { key: string; foundedOn: string; title: string }[]
  /** The stories joined to an overview whose cause or place quote passed only by the near match, with the joins bar's verdict on each. */
  nearMatches: { slug: string; overview: string; verdict: 'right' | 'wrong' | 'ignored' | null }[]
  /** The stories whose founding tried a further partner after one refused for reporting no occurrence: the partners tried in order, and whether the last founded (ADR-0075). */
  retries: { slug: string; tried: string[]; founded: boolean }[]
  /** The stories left out as founding partners because a founding check judged them to report no occurrence, with what the keys make of each (a must entry among them is a loss to read). */
  excluded: { slug: string; as: string }[]
  /** Every story still waiting for a re-center at the run's end (ADR-0078), in date order: what the keys make of it and the overview it waits for (`HeldStory`). */
  held: HeldStory[]
  /** The stories left out as founding partners because they waited for a re-center, with what the keys make of each. */
  heldPartners: { slug: string; as: string }[]
}

/**
 * A story waiting for a re-center, as the diagnostics read it: the overview it waits for and the
 * development, of any key, that overview stands for; for a must entry whether that is its own
 * development's (a re-center would file it right), another's or none's (it could only file it wrong,
 * or wait out the lookback), and whether its own development had no overview yet on its day (a hold
 * that may lose or delay that development's first founding).
 */
export interface HeldStory {
  slug: string
  date: string
  as: string
  overview: string
  development: string | null
  relation: 'own development' | 'another development' | 'no development' | 'not a must entry'
  beforeFounding: boolean
}

export interface DiagnoseInput {
  keys: readonly AnswerKey[]
  /** Every other key (the other half's, the label keys): they only say what a story outside the half is. */
  others: readonly AnswerKey[]
  run: number
  overviews: readonly FoundedOverview[]
  traces: ReadonlyMap<string, StoryTrace>
  roles: ReadonlyMap<string, Role>
  /** The slugs the run replayed. */
  replayed: ReadonlySet<string>
  /** Production's neighbour limit, to say when the read was cut at it. */
  neighbourLimit: number
  /** Why a slug was not replayed, where the replay knows another reason than that it is not published (a rescore: the keys name it since the run). */
  absent?: ReadonlyMap<string, string>
}

const pctOf = (v: number | null) => (v === null ? '?' : v.toFixed(2))

/** One run's diagnostics. */
export function diagnoseRun(d: DiagnoseInput): RunDiagnostics {
  const k = linkKeys(d.keys, d.others)
  const { entry, nearMiss, entryKeys: anyEntry } = k
  const otherIds = new Set(d.others.map(x => x.id))
  const devOf = new Map(d.overviews.map(o => [o.id, k.standsFor(o.members)]))
  /** Every key a must entry of the half is a must of, the outside keys included: an overview of any of them is its own. */
  const mustKeys = (slug: string) => k.all.get(slug)?.musts ?? new Map<string, KeyRole>()
  const overviewOf = new Map<string, FoundedOverview>()
  for (const o of d.overviews) for (const m of o.members) overviewOf.set(m, o)
  const titled = (id: string) => {
    const o = d.overviews.find(x => x.id === id)
    return o ? `"${o.title}" (${devOf.get(id) ?? 'no development'})` : id
  }
  /** What the keys make of a story: an entry, a near miss, or neither. */
  const what = (slug: string): string => {
    const e = entry.get(slug)
    if (e) return `${e.join} entry of ${e.join === 'must' ? [...e.musts.keys()].join(' and ') : e.key}`
    const outside = [...(anyEntry.get(slug) ?? [])].filter(id => otherIds.has(id))
    if (outside.length > 0) return `entry of ${outside.map(id => `${id} (${isLabelDevelopment(id) ? 'label key' : 'other half'})`).join(', ')}`
    const near = nearMiss.get(slug)
    return near ? `near miss of ${near.join(', ')}` : 'in no key'
  }
  /** The first overview of each development, by the day it was founded. */
  const firstOf = new Map<string, FoundedOverview>()
  for (const o of [...d.overviews].sort((a, b) => a.foundedOn.localeCompare(b.foundedOn))) {
    const dev = devOf.get(o.id)
    if (dev && !firstOf.has(dev)) firstOf.set(dev, o)
  }
  const when = (key: string, date: string) => {
    const first = firstOf.get(key)
    if (!first) return `; ${key} was never founded`
    return date < first.foundedOn ? `; before ${key}'s overview was founded (${first.foundedOn})` : ''
  }
  const neighbourText = (n: NeighbourCount | null) =>
    n
      ? `neighbours: ${n.read} read (${n.near} within the distance${n.near >= d.neighbourLimit ? `, cut at the limit of ${d.neighbourLimit}` : ''}), ${n.kept} replayed`
      : ''
  const answerText = (c: CandidateTrace) =>
    `${c.ref} ${c.distance.toFixed(2)}: ${c.belongs ?? 'no answer'}${c.belongs ? ` ${pctOf(c.confidence)}` : ''}${c.scope && c.scope !== 'inside' ? `, ${c.scope}` : ''}${c.refusal ? `, refused: ${c.refusal}` : ''}`
  const offered = (t: StoryTrace) =>
    [...t.overviews.map(c => `${answerText(c)} ${titled(c.id)}`), ...t.partners.map(c => `${answerText(c)} ${c.id} (${what(c.id)})`)].join('; ')

  const dateOf = new Map(d.keys.flatMap(k => [...k.entries, ...k.centers.flatMap(c => c.entries)].map(x => [x.slug, x.date] as const)))
  const missed: MissedEntry[] = []
  for (const [slug, e] of entry) {
    if (e.join !== 'must') continue
    const t = d.traces.get(slug)
    const date = t?.date ?? dateOf.get(slug) ?? ''
    const miss = (cause: MissCause, detail: string) => missed.push({ slug, key: [...e.musts.keys()].join(' or '), date, cause, detail })
    /** Whether an overview stands for one of the story's developments (a must of two keys has two, an outside key's among them). */
    const isOurs = (overviewId: string) => mustKeys(slug).has(devOf.get(overviewId) ?? '')
    const placedIn = overviewOf.get(slug)
    if (placedIn && isOurs(placedIn.id)) continue
    if (placedIn) {
      miss('in another overview', `in ${titled(placedIn.id)}${t?.outcome ? `, ${t.outcome}` : ''}`)
      continue
    }
    if (!t) {
      if (d.replayed.has(slug)) miss('not linked', 'the replay stopped before it')
      else miss('not replayed', d.absent?.get(slug) ?? 'not published in this database')
      continue
    }
    if (t.outcome === 'held' || t.outcome === 'conflict') {
      miss(t.outcome, offered(t))
      continue
    }
    if (t.outcome === 'failed' || t.outcome === null) {
      miss(
        'failed',
        t.founding
          ? `founding with ${t.founding.partner}: ${t.founding.why ?? t.founding.outcome}`
          : t.called
            ? 'nothing stored'
            : 'the link call gave no answer',
      )
      continue
    }
    if (!t.called) {
      miss('no candidate', `${neighbourText(t.neighbours) || 'no neighbour'}${when(e.key, t.date)}`)
      continue
    }
    const waitsFor = waitedFor(t)
    if (waitsFor) {
      const relation = isOurs(waitsFor)
        ? "its own development's overview"
        : devOf.get(waitsFor)
          ? "another development's overview"
          : 'an overview of no development'
      miss('held for a re-center', `of ${titled(waitsFor)}, ${relation}${when(e.key, t.date)}`)
      continue
    }
    const ours = [
      ...t.overviews.filter(c => isOurs(c.id)),
      ...t.partners.filter(c => [...mustKeys(slug).keys()].some(id => anyEntry.get(c.id)?.has(id) ?? false)),
    ]
    const at = when(e.key, t.date)
    if (ours.length === 0) {
      miss('not offered', `offered ${offered(t) || 'nothing of it'}; ${neighbourText(t.neighbours)}${at}`)
      continue
    }
    const refused = ours.find(c => c.refusal)
    const founding = t.founding && ours.some(c => c.id === t.founding!.partner) ? t.founding : null
    const detail = `${ours.map(answerText).join('; ')}${at}`
    const blockedBy = t.blockedBy && !isOurs(t.blockedBy) ? t.overviews.find(c => c.id === t.blockedBy) : undefined
    if (blockedBy && ours.some(c => t.partners.includes(c) && c.belongs === 'yes' && !c.refusal))
      miss('founding blocked', `a refused yes to ${titled(blockedBy.id)} (${blockedBy.refusal ?? 'refused'}); ${detail}`)
    else if (refused) miss('refused by code', `${refused.ref}: ${refused.refusal}; ${detail}`)
    else if (founding?.partnerSilent)
      miss('founding refused: partner reported no occurrence', `with ${founding.partner} (${what(founding.partner)}): ${founding.why ?? ''}; ${detail}`)
    else if (founding) miss('founding not agreed', `with ${founding.partner}: ${founding.outcome}, ${founding.why ?? ''}; ${detail}`)
    else if (ours.some(c => c.belongs === 'yes'))
      miss(
        'model yes, not taken',
        `${detail}; offered ${offered(t)}${t.founding ? `; founding with ${t.founding.partner}: ${t.founding.outcome}${t.founding.why ? `, ${t.founding.why}` : ''}` : ''}`,
      )
    else if (ours.some(c => c.belongs === 'unsure')) miss('model unsure', detail)
    else miss('model no', detail)
  }
  missed.sort((a, b) => a.key.localeCompare(b.key) || a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug))

  const roleMisses: RoleMiss[] = []
  let rolesJudged = 0
  let rolesEither = 0
  for (const [slug, e] of entry) {
    if (e.join !== 'must') continue
    const placedIn = overviewOf.get(slug)
    const given = d.roles.get(slug)
    const dev = placedIn ? devOf.get(placedIn.id) : undefined
    const expected = dev ? mustKeys(slug).get(dev) : undefined
    if (!dev || !expected || !given) continue
    rolesJudged++
    if (expected === 'either') rolesEither++
    else if (given.role !== expected) roleMisses.push({ slug, key: dev, expected, given })
  }

  const charters = d.overviews.map((o): CharterLine => {
    const dev = devOf.get(o.id) ?? null
    const members = { right: 0, wrong: 0, ignored: 0, unscored: 0 }
    for (const m of o.members) members[k.verdict(m, dev) ?? 'unscored']++
    return {
      id: o.id,
      title: o.title,
      development: dev,
      foundedOn: o.foundedOn,
      foundedFrom: o.foundedFrom.map(slug => ({ slug, as: what(slug) })),
      members,
      charter: o.charter,
    }
  })
  const firstFoundings = [...firstOf]
    .map(([key, o]) => ({ key, foundedOn: o.foundedOn, title: o.title }))
    .sort((a, b) => a.foundedOn.localeCompare(b.foundedOn) || a.key.localeCompare(b.key))
  const nearMatches = [...d.traces.values()].flatMap(t =>
    t.overviews
      .filter(c => c.nearMatch)
      .map(c => ({ slug: t.slug, overview: d.overviews.find(o => o.id === c.id)?.title ?? c.id, verdict: k.verdict(t.slug, devOf.get(c.id) ?? null) })),
  )
  const retries = [...d.traces.values()].flatMap(t =>
    t.retried
      ? [{ slug: t.slug, tried: [...t.retried.map(r => r.partner), ...(t.founding ? [t.founding.partner] : [])], founded: t.founding?.outcome === 'founded' }]
      : [],
  )
  const excludedSlugs = [...new Set([...d.traces.values()].flatMap(t => t.excluded ?? []))].sort()
  const excluded = excludedSlugs.map(slug => ({ slug, as: what(slug) }))
  const held = [...d.traces.values()]
    .flatMap((t): HeldStory[] => {
      const id = waitedFor(t)
      if (!id) return []
      const e = entry.get(t.slug)
      const dev = devOf.get(id) ?? null
      const must = e?.join === 'must'
      const own = must && mustKeys(t.slug).has(dev ?? '')
      const relation: HeldStory['relation'] = !must ? 'not a must entry' : own ? 'own development' : dev ? 'another development' : 'no development'
      const first = must ? firstOf.get(e.key) : undefined
      return [
        {
          slug: t.slug,
          date: t.date,
          as: what(t.slug),
          overview: d.overviews.find(o => o.id === id)?.title ?? id,
          development: dev,
          relation,
          beforeFounding: must && !own && (!first || t.date < first.foundedOn),
        },
      ]
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug))
  const heldPartners = [...new Set([...d.traces.values()].flatMap(t => t.heldPartners ?? []))].sort().map(slug => ({ slug, as: what(slug) }))
  return { run: d.run, missed, rolesJudged, rolesEither, roleMisses, charters, firstFoundings, nearMatches, retries, excluded, held, heldPartners }
}

/** Each development's missed must entries by cause, summed over the runs, in `MISS_CAUSES` order. */
export function missesByDevelopment(runs: readonly RunDiagnostics[]): { key: string; causes: Map<MissCause, number>; total: number }[] {
  const byKey = new Map<string, Map<MissCause, number>>()
  for (const r of runs)
    for (const m of r.missed) {
      const causes = byKey.get(m.key) ?? new Map<MissCause, number>()
      causes.set(m.cause, (causes.get(m.cause) ?? 0) + 1)
      byKey.set(m.key, causes)
    }
  return [...byKey].sort(([a], [b]) => a.localeCompare(b)).map(([key, causes]) => ({ key, causes, total: [...causes.values()].reduce((s, n) => s + n, 0) }))
}
