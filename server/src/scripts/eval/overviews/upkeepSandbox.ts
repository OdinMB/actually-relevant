/**
 * The upkeep's reads and writes over the overview sandbox (`overviewSandbox.ts`), by production's
 * rules: the state each overview is judged on is production's (`overviewStateOf`), the closings due
 * are read from the decisions as production's loader reads them (`pendingClosings`), and every write
 * is production's plan (`overviewPlans.ts`) applied to memory. So the `replay` step runs production's
 * upkeep (`runUpkeep`) day by day after each day's linking: the closing checks of the joins flagged as
 * reporting the end event, the status machine, bursts, reviews and the stands refreshes, each
 * overview's members' facts given by the step. Every story is published in a replay, so no member is
 * ever unpublished; the monthly audit does not run. Writes nothing to the database.
 */
import { config } from '../../../config.js'
import type { CloseCase } from '../../../services/overviewClose.js'
import { foundInputs, linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { STALE_RECENTER, STALE_REVIEW, planAudit, planBurst, planClosing, planRecenter, planReview, planStatus } from '../../../services/overviewPlans.js'
import {
  neighbourOverviews,
  neighbourStories,
  recenterCaseOf,
  type RecenterCase,
  type SignalRecord,
  type TurnedAwayRow,
} from '../../../services/overviewRecenter.js'
import type { ReviewCase } from '../../../services/overviewReview.js'
import { overviewStateOf } from '../../../services/overviewState.js'
import { namesEndEvent } from '../../../services/overviewTypes.js'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { StandsCase, UpkeepDeps } from '../../../services/overviewUpkeep.js'
import { applied } from '../../../services/overviewChanges.js'
import { activeEntries, roleOf, safeguardsOf, type Sandbox, type SandboxEntry, type SandboxOverview } from './overviewSandbox.js'

/** What the upkeep did that the replay reports: each safeguard's firings, by name. */
export type Safeguards = Map<string, number>

export type UpkeepSandbox = Omit<UpkeepDeps, 'close' | 'review' | 'stands' | 'recenter'> & {
  /** The safeguards fired so far, counted from the sandbox's decisions (`safeguardsOf`). */
  safeguards(): Safeguards
}

const byDate = (a: { datePublished: Date | null }, b: { datePublished: Date | null }) => (a.datePublished?.getTime() ?? 0) - (b.datePublished?.getTime() ?? 0)

/**
 * The upkeep's reads and writes over the sandbox; `facts` gives the members' usable, structured facts;
 * `now` the replay's clock; `neighbours` a story's neighbours as of a day, which bound a re-center (none
 * when not given).
 */
export function sandboxUpkeep(
  sandbox: Sandbox,
  facts: (storyIds: string[]) => MemberFact[],
  now: () => Date,
  neighbours: (storyId: string, asOf: Date) => Promise<Neighbour[]> = async () => [],
): UpkeepSandbox {
  const get = (id: string) => sandbox.overviews.get(id)
  const story = (id: string) => sandbox.stories.get(id)!
  const ctx = () => ({ ...sandbox.context(), now: now() })

  /** Production's `reviewCase` over memory: the active entries of published stories, oldest first. */
  const reviewCase = async (id: string): Promise<ReviewCase | null> => {
    const o = get(id)
    if (!o) return null
    return {
      overviewId: o.id,
      title: o.title,
      charter: o.charter,
      scope: o.scope,
      frozen: o.frozen,
      entries: activeEntries(o)
        .filter(e => e.published && e.datePublished !== null)
        .sort(byDate)
        .map(e => ({
          entryId: e.id,
          storyId: e.storyId!,
          title: e.title,
          label: story(e.storyId!).label,
          summary: story(e.storyId!).summary,
          date: e.date,
          role: roleOf(e),
          locked: e.locked,
        })),
      closingStoryId: o.status === 'closing' ? o.closingStoryId : null,
      lockedOut: o.lockedOut,
    }
  }

  /** `pendingClosings` over memory: live joins flagged as reporting the end event, of open or quiet unfrozen overviews that name one, with no settling close decision. */
  const closings = async (): Promise<CloseCase[]> => {
    const judged = new Set(
      sandbox.decisions.filter(d => d.kind === 'close' && d.outcome !== 'failed' && d.outcome !== 'stale').map(d => `${d.overviewId}:${d.storyId}`),
    )
    const flagged = sandbox.decisions.filter(d => d.kind === 'link' && d.outcome === 'joined' && !d.undone && readInputs(linkInputs, d.inputs)?.reportsEndEvent)
    return flagged
      .flatMap(d => {
        const o = d.overviewId ? get(d.overviewId) : undefined
        const e = o && activeEntries(o).find(x => x.storyId === d.storyId)
        if (!o || !e || !e.published || judged.has(`${o.id}:${d.storyId}`) || !(o.status === 'open' || o.status === 'quiet') || o.frozen) return []
        const charter = o.charter
        if (!namesEndEvent(charter)) return []
        return [
          {
            overviewId: o.id,
            charter,
            story: story(e.storyId!),
            entries: activeEntries(o)
              .filter(x => x.storyId !== e.storyId && x.datePublished!.getTime() <= e.datePublished!.getTime())
              .sort((a, b) => byDate(b, a))
              .slice(0, config.overviews.candidateEntries)
              .map(x => ({ title: x.title, date: x.date })),
          },
        ]
      })
      .sort((a, b) => a.story.datePublished.getTime() - b.story.datePublished.getTime())
  }

  /**
   * Production's `recenterCases` over memory: the same parts, built by the same rules (`recenterCaseOf`),
   * oldest founding first. Every story of a replay is published.
   */
  const recenterCases = async (at: { clock: Date; now: Date }): Promise<RecenterCase[]> => {
    const cases: RecenterCase[] = []
    const overviews = [...sandbox.overviews.values()].sort((a, b) => a.foundedAt.getTime() - b.foundedAt.getTime())
    for (const o of overviews) {
      const review = await reviewCase(o.id)
      if (!review) continue
      const records: SignalRecord[] = sandbox.decisions.flatMap(d => {
        const inputs = d.kind === 'link' && !d.undone && d.storyId ? readInputs(linkInputs, d.inputs) : null
        return inputs && inputs.signals.some(s => s.overviewId === o.id) ? [{ storyId: d.storyId!, signals: inputs.signals, linkedAt: inputs.linkedAt }] : []
      })
      const reviewDetached = o.entries.filter(e => e.status === 'detached' && e.detachedBy === 'review').map(e => e.storyId)
      const ids = [...new Set([...records.map(r => r.storyId), ...reviewDetached])].filter(id => sandbox.stories.has(id))
      const active = (await sandbox.memberships(ids)).active
      const rows: TurnedAwayRow[] = ids.map(id => {
        const s = story(id)
        const here = o.entries.filter(e => e.storyId === id && e.status === 'detached')
        const newest = here.reduce<SandboxEntry | null>((a, e) => (!a || (e.detachedAt?.getTime() ?? 0) > (a.detachedAt?.getTime() ?? 0) ? e : a), null)
        return {
          storyId: id,
          title: s.title,
          label: s.label,
          summary: s.summary,
          date: s.date,
          datePublished: s.datePublished,
          published: true,
          active: active.has(id),
          quotes: records.filter(r => r.storyId === id).flatMap(r => r.signals.filter(x => x.overviewId === o.id).map(x => x.quote)),
          row: newest ? { entryId: newest.id, detachedBy: newest.detachedBy, locked: here.some(e => e.locked) } : null,
        }
      })
      // The entries its founding made, from the found decision's change set as production reads them
      const founding = sandbox.decisions
        .filter(d => d.kind === 'found' && d.outcome === 'founded' && d.overviewId === o.id && !d.undone)
        .flatMap(d => (readInputs(foundInputs, d.inputs)?.created ?? []).flatMap(c => (c.table === 'entry' ? [c.id] : [])))
      const partial = recenterCaseOf(
        {
          review,
          state: o,
          entryDates: new Map(o.entries.flatMap(e => (e.datePublished ? [[e.id, e.datePublished] as const] : []))),
          founding,
          records,
          rows,
        },
        at,
      )
      if (!partial) continue
      const near = await neighbourOverviews(o.id, neighbourStories(partial), at.clock, {
        neighbours,
        memberships: (storyIds, asOf) => sandbox.memberships(storyIds, asOf),
        overviews: (overviewIds, asOf) => sandbox.candidateOverviews(overviewIds, asOf),
      })
      cases.push({ ...partial, neighbours: near })
    }
    return cases
  }

  const standsCase = (o: SandboxOverview, today: string): StandsCase => {
    const entries = activeEntries(o).sort(byDate)
    const members = facts(entries.map(e => e.storyId!))
    const marker = JSON.stringify([o.title, entries.map(e => [e.storyId, e.role, e.roleKind]), members.map(m => [m.storyId, m.fact.id])])
    return {
      overviewId: o.id,
      title: o.title,
      entries: entries.map(e => ({ storyId: e.storyId!, title: e.title, date: e.date, role: roleOf(e) })),
      members,
      lastSignature: o.lastSignature,
      marker,
      unchanged: o.lastMarker === marker && (o.lastUntil === null || today < o.lastUntil),
    }
  }

  return {
    safeguards: () => safeguardsOf(sandbox.decisions),
    closings,
    // No reader reports in a replay
    states: async () => [...sandbox.overviews.values()].filter(o => activeEntries(o).length > 0).map(o => overviewStateOf(o, activeEntries(o), null, now())),
    reviewCase,
    auditPicks: async () => [],
    standsCases: async today =>
      [...sandbox.overviews.values()].filter(o => o.scope === 'ongoing' && !o.hidden && o.slug !== null && !o.frozen).map(o => standsCase(o, today)),
    recenterCases,
    applyClosing: async (c, result) => {
      const rows = sandbox.rowsOf(c.overviewId)
      sandbox.write(rows, planClosing(rows?.overview ?? null, c, result, ctx()))
    },
    applyStatus: async (s, moves, clock) => {
      let rows = sandbox.rowsOf(s.id)
      if (!rows) return
      for (const p of planStatus(rows, moves, clock, ctx())) {
        sandbox.write(rows, p)
        rows = applied(rows, p)
      }
    },
    applyBurst: async s => {
      const rows = sandbox.rowsOf(s.id)
      const p = rows ? planBurst(rows.overview, s, ctx()) : null
      if (rows && p) sandbox.write(rows, p)
    },
    // Stale, applying nothing, when the rows no longer hold what the call was shown, as in production
    applyReview: async (c, result) => {
      const rows = sandbox.rowsOf(c.overviewId)
      if (!rows) return 'stale'
      const p = planReview(rows, c, result, ctx())
      sandbox.write(rows, p)
      return p.decision.outcome === STALE_REVIEW ? 'stale' : 'written'
    },
    // Stale, applying nothing, when the rows or a story to join changed, as in production
    applyRecenter: async (c, result) => {
      const rows = sandbox.rowsOf(c.overviewId)
      const active = (await sandbox.memberships(result.joins.map(j => j.storyId))).active
      const p = planRecenter(rows, c, result, new Set(active.keys()), ctx())
      sandbox.write(rows, p)
      return p.decision.outcome === STALE_RECENTER ? 'stale' : 'written'
    },
    applyAudit: async (c, result) => sandbox.write(null, planAudit(c, result, ctx())),
    applyStands: async (c, result, record, today) => {
      const o = get(c.overviewId)!
      if (record.signature !== null) Object.assign(o, { lastSignature: record.signature, lastMarker: record.marker, lastUntil: record.until })
      if (result.outcome === 'written') o.stands = { sentences: result.sentences, doing: result.doing, asOf: today }
      if (result.outcome === 'too_few_facts') o.stands = null
    },
  }
}
