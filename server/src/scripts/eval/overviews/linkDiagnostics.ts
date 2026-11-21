/**
 * The linking replay's diagnostics (`link.ts`; `.context/model-eval.md`, "Overview evals"): what lets a
 * rerun from the cache confirm why a bar failed. For each run: every must entry not found in its
 * development's overview, with why (not replayed, in another overview, no candidate, its development
 * not offered, refused by code with the rule, the founding not agreed, or the model's no or unsure with
 * its confidence and scope; the link answer gives no reason); the roles of found must entries that
 * disagree with the key; and every founded charter. No bars: the owner reads them. Pure.
 */
import type { LinkResult } from '../../../services/overviewLink.js'
import type { Charter, FoundingOutcome, LinkOutcome, Role } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'
import { developmentOf, entryKeysOf, keyIndex } from './linkScore.js'

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
  /** A founding attempted from this story: the partner's slug, the outcome, and why it did not found. */
  founding: { partner: string; outcome: FoundingOutcome; why: string | null } | null
}

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
  return {
    slug: slug(result.story.id),
    date: result.story.date,
    outcome: stored,
    called: result.answer !== null,
    neighbours,
    overviews: result.shown.overviews.map(o => candidate(o, o.id)),
    partners: result.shown.partners.map(p => candidate(p, slug(p.id))),
    founding: result.founding ? { partner: slug(result.founding.partner.id), outcome: result.founding.outcome, why: foundingWhy(result.founding) } : null,
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
  'not offered',
  'refused by code',
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
  /** The development it stands for (`developmentOf`), or null. */
  development: string | null
  foundedOn: string
  /** Each founding story with what the keys make of it. */
  foundedFrom: { slug: string; as: string }[]
  /** Its members against its development: must and optional entries, near misses, and the rest. */
  members: { must: number; optional: number; nearMisses: number; other: number }
  charter: Charter
}

export interface RunDiagnostics {
  run: number
  missed: MissedEntry[]
  /** Found must entries with a role, and those whose role disagrees with the key. */
  rolesJudged: number
  roleMisses: RoleMiss[]
  charters: CharterLine[]
}

export interface DiagnoseInput {
  keys: readonly AnswerKey[]
  /** The other half's keys: they only say what a story outside the half is. */
  others: readonly AnswerKey[]
  run: number
  overviews: readonly FoundedOverview[]
  traces: ReadonlyMap<string, StoryTrace>
  roles: ReadonlyMap<string, Role>
  /** The slugs the run replayed. */
  replayed: ReadonlySet<string>
  /** Production's neighbour limit, to say when the read was cut at it. */
  neighbourLimit: number
}

const pctOf = (v: number | null) => (v === null ? '?' : v.toFixed(2))

/** One run's diagnostics. */
export function diagnoseRun(d: DiagnoseInput): RunDiagnostics {
  const { entry, nearMiss } = keyIndex(d.keys)
  const anyEntry = entryKeysOf([...d.keys, ...d.others])
  const otherIds = new Set(d.others.map(k => k.id))
  const devOf = new Map(d.overviews.map(o => [o.id, developmentOf(o.members, entry)]))
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
    const outside = [...(anyEntry.get(slug) ?? [])].filter(k => otherIds.has(k))
    if (outside.length > 0) return `entry of ${outside.join(', ')} (other half)`
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
    /** Whether an overview stands for one of the story's developments (a must of two keys has two). */
    const isOurs = (overviewId: string) => e.musts.has(devOf.get(overviewId) ?? '')
    const placedIn = overviewOf.get(slug)
    if (placedIn && isOurs(placedIn.id)) continue
    if (placedIn) {
      miss('in another overview', `in ${titled(placedIn.id)}${t?.outcome ? `, ${t.outcome}` : ''}`)
      continue
    }
    if (!t) {
      miss(d.replayed.has(slug) ? 'not linked' : 'not replayed', d.replayed.has(slug) ? 'the replay stopped before it' : 'not published in this database')
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
    const ours = [...t.overviews.filter(c => isOurs(c.id)), ...t.partners.filter(c => [...e.musts.keys()].some(k => anyEntry.get(c.id)?.has(k) ?? false))]
    const at = when(e.key, t.date)
    if (ours.length === 0) {
      miss('not offered', `offered ${offered(t) || 'nothing of it'}; ${neighbourText(t.neighbours)}${at}`)
      continue
    }
    const refused = ours.find(c => c.refusal)
    const founding = t.founding && ours.some(c => c.id === t.founding!.partner) ? t.founding : null
    const detail = `${ours.map(answerText).join('; ')}${at}`
    if (refused) miss('refused by code', `${refused.ref}: ${refused.refusal}; ${detail}`)
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
  for (const [slug, e] of entry) {
    const placedIn = overviewOf.get(slug)
    const given = d.roles.get(slug)
    const dev = placedIn ? devOf.get(placedIn.id) : undefined
    const expected = dev ? e.musts.get(dev) : undefined
    if (!dev || !expected || !given) continue
    rolesJudged++
    if (given.role !== expected) roleMisses.push({ slug, key: dev, expected, given })
  }

  const charters = d.overviews.map((o): CharterLine => {
    const dev = devOf.get(o.id) ?? null
    const members = { must: 0, optional: 0, nearMisses: 0, other: 0 }
    for (const m of o.members) {
      const e = entry.get(m)
      if (dev && e?.musts.has(dev)) members.must++
      else if (dev && e?.optionalIn.has(dev)) members.optional++
      else if (dev && (nearMiss.get(m) ?? []).includes(dev)) members.nearMisses++
      else members.other++
    }
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
  return { run: d.run, missed, rolesJudged, roleMisses, charters }
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
