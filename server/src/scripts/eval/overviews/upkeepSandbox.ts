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
import { linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import { planAudit, planBurst, planClosing, planReview, planStatus } from '../../../services/overviewPlans.js'
import type { ReviewCase } from '../../../services/overviewReview.js'
import { overviewStateOf } from '../../../services/overviewState.js'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { StandsCase, UpkeepDeps } from '../../../services/overviewUpkeep.js'
import { applied } from '../../../services/overviewChanges.js'
import { activeEntries, roleOf, safeguardsOf, type Sandbox, type SandboxOverview } from './overviewSandbox.js'

/** What the upkeep did that the replay reports: each safeguard's firings, by name. */
export type Safeguards = Map<string, number>

export type UpkeepSandbox = Omit<UpkeepDeps, 'close' | 'review' | 'stands'> & {
  /** The safeguards fired so far, counted from the sandbox's decisions (`safeguardsOf`). */
  safeguards(): Safeguards
}

const byDate = (a: { datePublished: Date | null }, b: { datePublished: Date | null }) => (a.datePublished?.getTime() ?? 0) - (b.datePublished?.getTime() ?? 0)

/** The upkeep's reads and writes over the sandbox; `facts` gives the members' usable, structured facts; `now` the replay's clock. */
export function sandboxUpkeep(sandbox: Sandbox, facts: (storyIds: string[]) => MemberFact[], now: () => Date): UpkeepSandbox {
  const get = (id: string) => sandbox.overviews.get(id)
  const story = (id: string) => sandbox.stories.get(id)!
  const ctx = () => ({ ...sandbox.context(), now: now() })

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

  /** `pendingClosings` over memory: live joins flagged as reporting the end event, of open or quiet unfrozen overviews, with no settling close decision. */
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
        return [
          {
            overviewId: o.id,
            charter: o.charter,
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

  const standsCase = (o: SandboxOverview, today: string): StandsCase => {
    const entries = activeEntries(o).sort(byDate)
    const members = facts(entries.map(e => e.storyId!))
    const marker = JSON.stringify([entries.map(e => [e.storyId, e.role, e.roleKind]), members.map(m => [m.storyId, m.fact.id])])
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
    applyReview: async (c, result) => {
      const rows = sandbox.rowsOf(c.overviewId)
      if (rows) sandbox.write(rows, planReview(rows, c, result, ctx()))
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
