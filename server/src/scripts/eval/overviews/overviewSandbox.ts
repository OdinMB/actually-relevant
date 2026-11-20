/**
 * The overview sandbox (`.context/model-eval.md`, "Overview evals"; plan "Evals and bars"): overviews
 * kept in memory and written by production's own planners and write model (`overviewPlans.ts`,
 * `overviewChanges.ts`: the same plans, settled and applied the same way, only to memory instead of
 * the tables), so production's pure steps (`linkStory`, `linkInOrder`) replay a half's developments in
 * date order against it, and its upkeep (`upkeepSandbox.ts`) runs over the same rows. Like
 * production's applier it skips a story linked meanwhile and asks a stale result again, then stores it
 * as a conflict. Every write is kept as its decisions, which the replay's safeguards are counted from
 * (`safeguardsOf`). Writes nothing to the database.
 */
import { slugify } from '../../../utils/slugify.js'
import {
  applied,
  changeSet,
  overviewChange,
  settle,
  type DecisionDraft,
  type EntryRow,
  type OverviewRow,
  type Plan,
  type Rows,
} from '../../../services/overviewChanges.js'
import { entryRole } from '../../../services/overviewCases.js'
import { linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import { isStale, type ApplyLink } from '../../../services/overviewLink.js'
import type { LinkAttempt, OwedStory } from '../../../services/overviewOwed.js'
import { planAlone, planConflict, planFounding, planJoin, type LinkPlan, type PlanContext } from '../../../services/overviewPlans.js'
import {
  SETTLING_OUTCOMES,
  type CandidateOverview,
  type LinkOutcome,
  type LinkStory,
  type Membership,
  type Memberships,
  type Role,
  type StandsLine,
} from '../../../services/overviewTypes.js'

/** An entry as production's row holds it, with what the replay shows of its story. */
export interface SandboxEntry extends EntryRow {
  /** Every entry of a replay is a story's. */
  storyId: string
  title: string
  date: string
}

/** An overview as production's row holds it, with its entries and what the replay reports of it. */
export interface SandboxOverview extends OverviewRow {
  /** Its entries in the order they were made, the two founding stories first; detached ones stay. */
  entries: SandboxEntry[]
  foundedFrom: [string, string]
  /** The current stands, and the last refresh's record (signature, marker, the day its offer next changes). */
  stands: { sentences: StandsLine[]; doing: StandsLine[]; asOf: string } | null
  lastSignature: string | null
  lastMarker: string | null
  lastUntil: string | null
}

/** A decision as the sandbox keeps it: what production's applier writes. */
export type SandboxDecision = DecisionDraft & { undone: boolean }

export interface Sandbox {
  overviews: Map<string, SandboxOverview>
  /** Each story's stored outcome and role. */
  results: Map<string, { outcome: LinkOutcome; role: Role | null }>
  /** The stories linked so far, as linking read them. */
  stories: Map<string, LinkStory>
  /** Every decision written, in order. */
  decisions: SandboxDecision[]
  memberships(storyIds: string[], asOf?: Date): Promise<Memberships>
  candidateOverviews(ids: string[], asOf: Date): Promise<CandidateOverview[]>
  apply: ApplyLink
  /** An overview's rows as a plan is made on them; null when there is no such overview. */
  rowsOf(id: string): Rows | null
  /** Writes a plan as production's applier does (`applyPlan`), to memory. */
  write(rows: Rows | null, plan: Plan): void
  /** What a plan is made with: the sandbox's clock and its next ids. */
  context(): PlanContext
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
  const decisions: SandboxDecision[] = []
  let clock = new Date(0)
  let ids = 0
  const context = (): PlanContext => ({ now: clock, newId: () => `sandbox-${++ids}` })

  /** Its active entries published on or before `asOf`, newest first: the development as it stood on that day. */
  const entriesAsOf = (o: SandboxOverview, asOf?: Date) =>
    activeEntries(o)
      .filter(e => !asOf || (e.datePublished !== null && e.datePublished.getTime() <= asOf.getTime()))
      .sort((a, b) => b.datePublished!.getTime() - a.datePublished!.getTime())
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
    // No editor acts in a replay, so no story is locked out of an overview
    lockedOut: new Map(),
  })
  const candidateOverviews = async (storyIds: string[], asOf: Date): Promise<CandidateOverview[]> =>
    storyIds.flatMap(id => {
      const o = overviews.get(id)
      if (!o) return []
      const newest = entriesAsOf(o, asOf).slice(0, 5)
      return [{ id, title: o.title, charter: o.charter, entries: newest.map(e => ({ title: e.title, date: e.date })) }]
    })

  const rowsOf = (id: string): Rows | null => {
    const o = overviews.get(id)
    return o ? { overview: o, entries: o.entries } : null
  }

  const write = (rows: Rows | null, planned: Plan) => {
    if (!rows && !planned.newOverview) {
      // A decision about no overview row: a story left alone, a conflict, an audit
      decisions.push({ ...planned.decision, undone: false }, ...planned.also.map(d => ({ ...d, undone: false })))
      return
    }
    let p = settle(rows, planned)
    if (p.needsSlug) {
      const after = applied(rows, p).overview
      if (after.slug === null) p = { ...p, changes: [...p.changes, ...overviewChange(after, { slug: slugify(after.title) })] }
    }
    const after = applied(rows, p)
    const n = p.newOverview
    let o = n ? undefined : overviews.get(after.overview.id)
    if (n) {
      const [first, second] = p.newEntries
      const [a, b] = first && second && second.datePublished.getTime() <= first.datePublished.getTime() ? [second, first] : [first, second]
      o = { ...after.overview, entries: [], foundedFrom: [a!.storyId, b!.storyId], stands: null, lastSignature: null, lastMarker: null, lastUntil: null }
      overviews.set(o.id, o)
    }
    if (!o) throw new Error(`No overview ${after.overview.id} in the sandbox`)
    const { entries: _entries, ...row } = after.overview as SandboxOverview
    Object.assign(o, row)
    for (const e of after.entries) {
      const had = o.entries.find(x => x.id === e.id)
      if (had) Object.assign(had, e)
      else {
        const s = stories.get(e.storyId!)
        o.entries.push({ ...e, storyId: e.storyId!, title: s?.title ?? '', date: s?.date ?? '' })
      }
    }
    decisions.push({ ...p.decision, inputs: { ...p.decision.inputs, ...changeSet(p) }, undone: false }, ...p.also.map(d => ({ ...d, undone: false })))
    if (p.undoesLinksOf) for (const d of decisions) if (d.kind === 'link' && d.storyId === p.undoesLinksOf) d.undone = true
  }

  const apply: ApplyLink = async (result, lastTry) => {
    stories.set(result.story.id, result.story)
    if (result.founding) stories.set(result.founding.partner.id, result.founding.partner)
    const settled = results.get(result.story.id)
    if (activeIn(result.story.id) || (settled && SETTLES.has(settled.outcome))) return { kind: 'skipped' }
    const ctx = context()
    let rows: Rows | null = null
    let linked: LinkPlan
    if (isStale(result, await memberships(result.shown.partners.map(p => p.id)))) {
      if (!lastTry) return { kind: 'stale' }
      linked = planConflict(result, ctx)
    } else if (result.outcome === 'joined') {
      rows = rowsOf(result.join!.candidate.id)
      linked = planJoin(rows?.overview ?? null, result, ctx)
    } else if (result.outcome === 'founded') linked = planFounding(result, ctx)
    else linked = planAlone(result, ctx)
    write(rows, linked.plan)
    results.set(result.story.id, { outcome: linked.outcome, role: result.role })
    if (linked.outcome === 'founded') {
      const partner = result.founding!.partner.id
      const entry = [...overviews.values()].flatMap(o => o.entries).find(e => e.storyId === partner && e.status === 'active')
      results.set(partner, { outcome: 'founded', role: entry ? entryRole(entry) : null })
      const own = [...overviews.values()].flatMap(o => o.entries).find(e => e.storyId === result.story.id && e.status === 'active')
      if (own) results.set(result.story.id, { outcome: 'founded', role: entryRole(own) })
    }
    return { kind: 'written', outcome: linked.outcome }
  }

  return {
    overviews,
    results,
    stories,
    decisions,
    memberships,
    candidateOverviews,
    apply,
    rowsOf,
    write,
    context,
    setClock: at => {
      clock = at
    },
  }
}

/**
 * The stories of `candidates` (published by now) still owed a link decision by production's rule
 * (active in no overview, no live settling `link` decision), each with its link decisions as the owed
 * rule reads them, for `owedSlices` to slice as production's `owedStories` does.
 */
export function owedOf(sandbox: Sandbox, candidates: readonly { id: string; datePublished: Date }[]): OwedStory[] {
  const active = new Set([...sandbox.overviews.values()].flatMap(o => activeEntries(o).map(e => e.storyId)))
  const links = new Map<string, SandboxDecision[]>()
  for (const d of sandbox.decisions) if (d.kind === 'link' && d.storyId) links.set(d.storyId, [...(links.get(d.storyId) ?? []), d])
  return candidates.flatMap(s => {
    const own = links.get(s.id) ?? []
    if (active.has(s.id) || own.some(d => !d.undone && SETTLES.has(d.outcome as LinkOutcome))) return []
    const attempts: LinkAttempt[] = own.map(d => ({
      outcome: d.outcome as LinkOutcome,
      undone: d.undone,
      at: readInputs(linkInputs, d.inputs)?.linkedAt ?? new Date(0),
      heldFrozen: d.outcome === 'held' && d.overviewId !== null && sandbox.overviews.get(d.overviewId)?.frozen === true,
    }))
    return [{ id: s.id, datePublished: s.datePublished, attempts }]
  })
}

/**
 * The safeguards that fired, by name, counted from the decisions written (what the replay reports):
 * end-event checks that did not begin a closing, closings cancelled (by a new entry, by a review, by an
 * unpublished member), bursts, the review brake, what reviews did and what code refused of them, and
 * the automated re-center's attempts by outcome, by the rule that refused one and by what fired it.
 */
export function safeguardsOf(decisions: readonly SandboxDecision[]): Map<string, number> {
  const fired = new Map<string, number>()
  const add = (name: string, n = 1) => {
    if (n > 0) fired.set(name, (fired.get(name) ?? 0) + n)
  }
  for (const d of decisions) {
    const inputs = d.inputs as {
      reason?: string | null
      by?: string | null
      actions?: { kind: string }[]
      refusals?: unknown[]
      brake?: unknown
      changes?: { table: string; after: { detachReason?: string } }[]
    }
    if (d.kind === 'close' && d.outcome !== 'closing' && d.outcome !== 'failed') add(`closing refused (${d.outcome})`)
    if (d.kind === 'status' && inputs.reason === 'closing_cancelled')
      add(
        inputs.by === 'review'
          ? 'closing cancelled by its review'
          : inputs.by === 'unpublished'
            ? 'closing cancelled: its story unpublished'
            : 'closing cancelled by a new entry',
      )
    if (d.kind === 'status' && d.outcome === 'frozen') add('burst froze an overview')
    if (d.kind === 'review' && d.outcome === 'reviewed') {
      add('review detached an entry', (inputs.changes ?? []).filter(c => c.table === 'entry' && c.after.detachReason === 'review').length)
      add('review relabeled a role', (inputs.actions ?? []).filter(a => a.kind === 'relabel').length)
      add('review narrowed the charter', (inputs.actions ?? []).filter(a => a.kind === 'narrow').length)
      add('review answers refused', (inputs.refusals ?? []).length)
      if (inputs.brake) add('review brake froze an overview')
    }
    // Attempts by outcome, refusals by the rule that held, and by what fired them
    if (d.kind === 'recenter') {
      const r = d.inputs as { rule?: string | null; fired?: { wider: number; centerMoved: number } | null }
      add(d.outcome === 'refused' ? `re-center refused (${r.rule ?? 'unknown'})` : `re-center ${d.outcome}`)
      if (r.fired?.centerMoved) add('re-center attempt fired by a center flag')
      else if (r.fired?.wider) add('re-center attempt fired by wider flags')
    }
  }
  return fired
}
