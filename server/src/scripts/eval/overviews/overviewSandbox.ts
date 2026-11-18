/**
 * The overview sandbox (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): overviews
 * kept in memory, written by the same rules as production's lifecycle (`applyLink`: a story linked
 * meanwhile is skipped, a stale result asked again and then a conflict, a join adds an entry and opens
 * a quiet or faded overview, a founding adds an overview with both entries), so production's pure
 * steps (`linkStory`, `linkInOrder`) replay a half's developments in date order against it. Writes
 * nothing to the database.
 */
import { isStale, type ApplyLink, type LinkResult } from '../../../services/overviewLink.js'
import {
  SETTLING_OUTCOMES,
  type CandidateOverview,
  type Charter,
  type LinkOutcome,
  type Membership,
  type Memberships,
  type OverviewStatus,
  type Role,
} from '../../../services/overviewTypes.js'

export interface SandboxOverview {
  id: string
  title: string
  charter: Charter
  status: OverviewStatus
  closedReason: string | null
  frozen: boolean
  lastEntryAt: Date
  /** Its members in the order they joined, the two founding stories first. */
  entries: { storyId: string; title: string; date: string; datePublished: Date; role: Role }[]
  foundedFrom: [string, string]
}

export interface Sandbox {
  overviews: Map<string, SandboxOverview>
  /** Each story's stored outcome and role. */
  results: Map<string, { outcome: LinkOutcome; role: Role | null }>
  memberships(storyIds: string[], asOf?: Date): Promise<Memberships>
  candidateOverviews(ids: string[], asOf: Date): Promise<CandidateOverview[]>
  apply: ApplyLink
}

const SETTLES: ReadonlySet<LinkOutcome> = new Set(SETTLING_OUTCOMES)

export function createSandbox(): Sandbox {
  const overviews = new Map<string, SandboxOverview>()
  const activeOf = new Map<string, string>()
  const results = new Map<string, { outcome: LinkOutcome; role: Role | null }>()
  /** Its entries published on or before `asOf`, newest first: the development as it stood on that day. */
  const entriesAsOf = (o: SandboxOverview, asOf?: Date) =>
    o.entries.filter(e => !asOf || e.datePublished.getTime() <= asOf.getTime()).sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime())
  const membership = (o: SandboxOverview, asOf?: Date): Membership => ({
    overviewId: o.id,
    scope: 'forming',
    status: o.status,
    closedReason: o.closedReason,
    frozen: o.frozen,
    lastEntryAt: asOf ? (entriesAsOf(o, asOf)[0]?.datePublished ?? null) : o.lastEntryAt,
  })
  const memberships = async (storyIds: string[], asOf?: Date): Promise<Memberships> => ({
    active: new Map(storyIds.flatMap(id => (activeOf.has(id) ? [[id, membership(overviews.get(activeOf.get(id)!)!, asOf)] as const] : []))),
    lockedOut: new Map(),
  })
  const candidateOverviews = async (ids: string[], asOf: Date): Promise<CandidateOverview[]> =>
    ids.flatMap(id => {
      const o = overviews.get(id)
      if (!o) return []
      const newest = entriesAsOf(o, asOf).slice(0, 5)
      return [{ id, title: o.title, charter: o.charter, entries: newest.map(e => ({ title: e.title, date: e.date })) }]
    })
  const record = (result: LinkResult, outcome: LinkOutcome) => {
    results.set(result.story.id, { outcome, role: result.role })
    return { kind: 'written', outcome } as const
  }
  const entryOf = (s: LinkResult['story'], role: Role) => ({ storyId: s.id, title: s.title, date: s.date, datePublished: s.datePublished, role })
  const apply: ApplyLink = async (result, lastTry) => {
    const settled = results.get(result.story.id)
    if (activeOf.has(result.story.id) || (settled && SETTLES.has(settled.outcome))) return { kind: 'skipped' }
    if (isStale(result, await memberships(result.shown.partners.map(p => p.id)))) return lastTry ? record(result, 'conflict') : { kind: 'stale' }
    if (result.outcome === 'joined') {
      const o = overviews.get(result.join!.candidate.id)
      if (!o || (o.status === 'closed' && o.closedReason !== 'faded')) return record(result, 'conflict')
      if (o.frozen) return record(result, 'held')
      o.entries.push(entryOf(result.story, result.role ?? { role: 'routine', roleKind: null }))
      if (result.story.datePublished > o.lastEntryAt) o.lastEntryAt = result.story.datePublished
      if (o.status !== 'open' && o.status !== 'closing') Object.assign(o, { status: 'open', closedReason: null })
      activeOf.set(result.story.id, o.id)
      return record(result, 'joined')
    }
    if (result.outcome === 'founded') {
      const f = result.founding!
      const draft = f.draft!
      const [a, b] = f.partner.datePublished <= result.story.datePublished ? [f.partner, result.story] : [result.story, f.partner]
      const id = `sandbox-${overviews.size + 1}`
      overviews.set(id, {
        id,
        title: draft.title,
        charter: draft.charter,
        status: 'open',
        closedReason: null,
        frozen: false,
        lastEntryAt: b.datePublished,
        entries: [entryOf(a, draft.roles.a), entryOf(b, draft.roles.b)],
        foundedFrom: [a.id, b.id],
      })
      activeOf.set(a.id, id)
      activeOf.set(b.id, id)
      results.set(f.partner.id, { outcome: 'founded', role: a.id === f.partner.id ? draft.roles.a : draft.roles.b })
      return record(result, 'founded')
    }
    return record(result, result.outcome)
  }
  return { overviews, results, memberships, candidateOverviews, apply }
}
