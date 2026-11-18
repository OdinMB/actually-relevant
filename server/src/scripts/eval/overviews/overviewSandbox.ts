/**
 * The overview sandbox (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): overviews
 * kept in memory, written by the same rules as production's lifecycle (`applyLink`: a story linked
 * meanwhile is skipped, a stale result asked again and then a conflict, a join adds an entry and opens
 * a quiet or faded overview, a founding adds an overview with both entries), so production's pure
 * steps (`linkStory`, `linkInOrder`) replay a half's developments in date order against it. The
 * upkeep's writes are `upkeepSandbox.ts`'s, over the same overviews. Writes nothing to the database.
 */
import type { StandsLine } from '../../../services/overviewTypes.js'
import { isStale, type ApplyLink, type LinkResult } from '../../../services/overviewLink.js'
import {
  SETTLING_OUTCOMES,
  type CandidateOverview,
  type Charter,
  type LinkOutcome,
  type LinkStory,
  type Membership,
  type Memberships,
  type OverviewScope,
  type OverviewStatus,
  type Role,
} from '../../../services/overviewTypes.js'

export interface SandboxEntry {
  entryId: string
  storyId: string
  title: string
  date: string
  datePublished: Date
  role: Role
  status: 'active' | 'detached'
  /** The sandbox's clock when it joined: the burst check counts joins of one night. */
  joinedAt: Date
  /** The link call flagged it as reporting the end event, and whether the closing checks judged it. */
  reportsEndEvent: boolean
  closeChecked: boolean
}

export interface SandboxOverview {
  id: string
  title: string
  charter: Charter
  scope: OverviewScope
  status: OverviewStatus
  closedReason: string | null
  frozen: boolean
  lastEntryAt: Date
  closingSince: Date | null
  closingStoryId: string | null
  closedAt: Date | null
  entriesAtLastReview: number
  reviewedAt: Date | null
  burstAt: Date | null
  /** The closing a closure review ran for. */
  closureReviewedFor: Date | null
  /** Its members in the order they joined, the two founding stories first; detached ones stay. */
  entries: SandboxEntry[]
  foundedFrom: [string, string]
  /** The current stands, and the last refresh's signature. */
  stands: { sentences: StandsLine[]; doing: StandsLine[]; asOf: string } | null
  lastSignature: string | null
}

export interface Sandbox {
  overviews: Map<string, SandboxOverview>
  /** Each story's stored outcome and role. */
  results: Map<string, { outcome: LinkOutcome; role: Role | null }>
  /** The stories linked so far, as linking read them. */
  stories: Map<string, LinkStory>
  memberships(storyIds: string[], asOf?: Date): Promise<Memberships>
  candidateOverviews(ids: string[], asOf: Date): Promise<CandidateOverview[]>
  apply: ApplyLink
  /** The entry of a story leaves its overview (a review's detach). */
  detach(storyId: string): void
  /** The sandbox's clock, which joins are stamped with: the replay sets it to each day. */
  setClock(at: Date): void
}

const SETTLES: ReadonlySet<LinkOutcome> = new Set(SETTLING_OUTCOMES)

export const activeEntries = (o: SandboxOverview): SandboxEntry[] => o.entries.filter(e => e.status === 'active')

export function createSandbox(): Sandbox {
  const overviews = new Map<string, SandboxOverview>()
  /** The overview a story is an active entry of: one at most, as production's partial index holds. */
  const activeIn = (storyId: string) => [...overviews.values()].find(o => o.entries.some(e => e.storyId === storyId && e.status === 'active'))
  const results = new Map<string, { outcome: LinkOutcome; role: Role | null }>()
  const stories = new Map<string, LinkStory>()
  let clock = new Date(0)
  let entryCount = 0
  /** Its active entries published on or before `asOf`, newest first: the development as it stood on that day. */
  const entriesAsOf = (o: SandboxOverview, asOf?: Date) =>
    activeEntries(o)
      .filter(e => !asOf || e.datePublished.getTime() <= asOf.getTime())
      .sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime())
  const membership = (o: SandboxOverview, asOf?: Date): Membership => ({
    overviewId: o.id,
    scope: o.scope,
    status: o.status,
    closedReason: o.closedReason,
    frozen: o.frozen,
    lastEntryAt: asOf ? (entriesAsOf(o, asOf)[0]?.datePublished ?? null) : o.lastEntryAt,
  })
  const memberships = async (storyIds: string[], asOf?: Date): Promise<Memberships> => ({
    active: new Map(
      storyIds.flatMap(id => {
        const o = activeIn(id)
        return o ? [[id, membership(o, asOf)] as const] : []
      }),
    ),
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
  const entryOf = (s: LinkStory, role: Role, reportsEndEvent = false): SandboxEntry => {
    stories.set(s.id, s)
    return {
      entryId: `entry-${++entryCount}`,
      storyId: s.id,
      title: s.title,
      date: s.date,
      datePublished: s.datePublished,
      role,
      status: 'active',
      joinedAt: clock,
      reportsEndEvent,
      closeChecked: false,
    }
  }
  const apply: ApplyLink = async (result, lastTry) => {
    stories.set(result.story.id, result.story)
    const settled = results.get(result.story.id)
    if (activeIn(result.story.id) || (settled && SETTLES.has(settled.outcome))) return { kind: 'skipped' }
    if (isStale(result, await memberships(result.shown.partners.map(p => p.id)))) return lastTry ? record(result, 'conflict') : { kind: 'stale' }
    if (result.outcome === 'joined') {
      const o = overviews.get(result.join!.candidate.id)
      if (!o || (o.status === 'closed' && o.closedReason !== 'faded')) return record(result, 'conflict')
      if (o.frozen) return record(result, 'held')
      o.entries.push(entryOf(result.story, result.role ?? { role: 'routine', roleKind: null }, result.join!.reportsEndEvent))
      if (result.story.datePublished > o.lastEntryAt) o.lastEntryAt = result.story.datePublished
      if (o.status === 'quiet' || o.status === 'closed') Object.assign(o, { status: 'open', closedReason: null, closedAt: null, closingSince: null })
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
        scope: 'forming',
        status: 'open',
        closedReason: null,
        frozen: false,
        lastEntryAt: b.datePublished,
        closingSince: null,
        closingStoryId: null,
        closedAt: null,
        entriesAtLastReview: 0,
        reviewedAt: null,
        burstAt: null,
        closureReviewedFor: null,
        entries: [entryOf(a, draft.roles.a), entryOf(b, draft.roles.b)],
        foundedFrom: [a.id, b.id],
        stands: null,
        lastSignature: null,
      })
      results.set(f.partner.id, { outcome: 'founded', role: a.id === f.partner.id ? draft.roles.a : draft.roles.b })
      return record(result, 'founded')
    }
    return record(result, result.outcome)
  }
  const detach = (storyId: string) => {
    const o = activeIn(storyId)
    if (!o) return
    for (const e of o.entries) if (e.storyId === storyId) e.status = 'detached'
    const newest = entriesAsOf(o)[0]
    if (newest) o.lastEntryAt = newest.datePublished
  }
  return {
    overviews,
    results,
    stories,
    memberships,
    candidateOverviews,
    apply,
    detach,
    setClock: at => {
      clock = at
    },
  }
}
