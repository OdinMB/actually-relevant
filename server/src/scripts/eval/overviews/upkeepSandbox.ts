/**
 * The upkeep's reads and writes over the overview sandbox (`overviewSandbox.ts`), by production's
 * rules: the state each overview is judged on is production's (`overviewStateOf`), the review and
 * re-center cases are built from the sandbox's rows by production's own case assembly
 * (`overviewCases.ts`), and every write is production's plan (`overviewPlans.ts`) applied to memory. So
 * the `replay` step runs production's
 * upkeep (`runUpkeep`) day by day after each day's linking: the status machine, bursts, re-centers,
 * reviews and the stands refreshes, each overview's members' facts given by the step. Every story is
 * published in a replay, so no member is ever unpublished; the monthly audit does not run. Writes
 * nothing to the database.
 */
import { entryRole, recenterPartsOf, recenterStoryIds, reviewCaseOf, type CaseEntry } from '../../../services/overviewCases.js'
import { foundingEntries, linkInputs, readInputs } from '../../../services/overviewDecisions.js'
import type { Neighbour } from '../../../services/overviewCandidates.js'
import { STALE_RECENTER, STALE_REVIEW, planAudit, planBurst, planRecenter, planReview, planStatus } from '../../../services/overviewPlans.js'
import { neighbourOverviews, neighbourStories, recenterCaseOf, type RecenterCase, type SignalRecord } from '../../../services/overviewRecenter.js'
import type { ReviewCase } from '../../../services/overviewReview.js'
import { overviewStateOf } from '../../../services/overviewState.js'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { StandsCase, UpkeepDeps } from '../../../services/overviewUpkeep.js'
import { applied } from '../../../services/overviewChanges.js'
import { activeEntries, safeguardsOf, type Sandbox, type SandboxOverview } from './overviewSandbox.js'

/** What the upkeep did that the replay reports: each safeguard's firings, by name. */
export type Safeguards = Map<string, number>

export type UpkeepSandbox = Omit<UpkeepDeps, 'review' | 'stands' | 'recenter'> & {
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
  const ctx = () => ({ ...sandbox.context(), now: now() })

  /** An overview's entries as production's loaders read them: each row with its story's text. */
  const caseEntries = (o: SandboxOverview): CaseEntry[] =>
    o.entries.map(e => ({ ...e, label: sandbox.stories.get(e.storyId)?.label ?? '', summary: sandbox.stories.get(e.storyId)?.summary ?? '' }))

  /** Production's `reviewCase` over memory: the same rule (`reviewCaseOf`). */
  const reviewCase = async (id: string): Promise<ReviewCase | null> => {
    const o = get(id)
    return o ? reviewCaseOf(o, caseEntries(o)) : null
  }

  /**
   * Production's `recenterCases` over memory: the same parts, built and decided by the same rules
   * (`recenterPartsOf`, `recenterCaseOf`), oldest founding first. Every story of a replay is published.
   */
  const recenterCases = async (at: { clock: Date; now: Date }): Promise<RecenterCase[]> => {
    const cases: RecenterCase[] = []
    const overviews = [...sandbox.overviews.values()].sort((a, b) => a.foundedAt.getTime() - b.foundedAt.getTime())
    for (const o of overviews) {
      const records: SignalRecord[] = sandbox.decisions.flatMap(d => {
        const inputs = d.kind === 'link' && !d.undone && d.storyId ? readInputs(linkInputs, d.inputs) : null
        return inputs && inputs.signals.some(s => s.overviewId === o.id) ? [{ storyId: d.storyId!, signals: inputs.signals, linkedAt: inputs.linkedAt }] : []
      })
      const entries = caseEntries(o)
      const ids = recenterStoryIds(o.id, entries, records)
      const stories = ids.flatMap(id => sandbox.stories.get(id) ?? [])
      const active = new Set((await sandbox.memberships(ids)).active.keys())
      const founding = foundingEntries(sandbox.decisions.filter(d => d.overviewId === o.id))
      const partial = recenterCaseOf(recenterPartsOf({ overview: o, entries, founding, records, stories, active }), at)
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
      entries: entries.map(e => ({ storyId: e.storyId, title: e.title, date: e.date, role: entryRole(e) })),
      members,
      lastSignature: o.lastSignature,
      marker,
      unchanged: o.lastMarker === marker && (o.lastUntil === null || today < o.lastUntil),
    }
  }

  return {
    safeguards: () => safeguardsOf(sandbox.decisions),
    // No reader reports in a replay
    states: async () => [...sandbox.overviews.values()].filter(o => activeEntries(o).length > 0).map(o => overviewStateOf(o, activeEntries(o), null, now())),
    reviewCase,
    auditPicks: async () => [],
    // The evals measure the stands, so they write them whatever production's stands gate says
    standsOn: true,
    standsCases: async today =>
      [...sandbox.overviews.values()].filter(o => o.scope === 'ongoing' && !o.hidden && o.slug !== null && !o.frozen).map(o => standsCase(o, today)),
    recenterCases,
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
    // Stale, applying nothing, when the rows or a story to join changed, as in production (every story of a replay stays published)
    applyRecenter: async (c, result) => {
      const rows = sandbox.rowsOf(c.overviewId)
      const active = (await sandbox.memberships(result.joins.map(j => j.storyId))).active
      const p = planRecenter(rows, c, result, { active: new Set(active.keys()), published: new Set(c.stories.map(s => s.storyId)) }, ctx())
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
