/**
 * The upkeep's reads and writes over the overview sandbox (`overviewSandbox.ts`), by the rules of
 * production's lifecycle and loaders (`overviewLifecycle.ts`, `overviewUpkeepInput.ts`), so the
 * `replay` step runs production's upkeep (`runUpkeep`) day by day after each day's linking: the
 * closing checks of the joins flagged as reporting the end event, the status machine, bursts,
 * reviews and the stands refreshes, each overview's members' facts given by the step. Every story is
 * published in a replay, so no member is ever unpublished; the monthly audit does not run. Writes
 * nothing to the database.
 */
import type { CloseCase } from '../../../services/overviewClose.js'
import type { ReviewCase } from '../../../services/overviewReview.js'
import type { MemberFact } from '../../../services/overviewStands.js'
import type { OverviewState } from '../../../services/overviewTypes.js'
import type { StandsCase, UpkeepDeps } from '../../../services/overviewUpkeep.js'
import { config } from '../../../config.js'
import { activeEntries, type Sandbox, type SandboxOverview } from './overviewSandbox.js'

/** What the upkeep did that the replay reports: each safeguard's firings, by name. */
export type Safeguards = Map<string, number>

export type UpkeepSandbox = Omit<UpkeepDeps, 'close' | 'review' | 'stands'> & { safeguards: Safeguards }

const HOUR_MS = 3_600_000

/** The upkeep's reads and writes over the sandbox; `facts` gives the members' usable, structured facts; `now` the replay's clock. */
export function sandboxUpkeep(sandbox: Sandbox, facts: (storyIds: string[]) => MemberFact[], now: () => Date): UpkeepSandbox {
  const safeguards: Safeguards = new Map()
  const fired = (name: string) => safeguards.set(name, (safeguards.get(name) ?? 0) + 1)
  const get = (id: string) => sandbox.overviews.get(id)
  const story = (id: string) => sandbox.stories.get(id)!

  const state = (o: SandboxOverview): OverviewState => {
    const since = now().getTime() - config.overviews.nightHours * HOUR_MS
    const byDay = new Map<string, number>()
    for (const e of activeEntries(o)) if (e.joinedAt.getTime() > since) byDay.set(e.date, (byDay.get(e.date) ?? 0) + 1)
    return {
      id: o.id,
      scope: o.scope,
      status: o.status,
      closedReason: o.closedReason,
      frozen: o.frozen,
      hidden: false,
      lastEntryAt: o.lastEntryAt,
      closingSince: o.closingSince,
      activeEntries: activeEntries(o).length,
      unpublished: [],
      entriesAtLastReview: o.entriesAtLastReview,
      reviewedAt: o.reviewedAt,
      burstJoins: Math.max(0, ...byDay.values()),
      burstAt: o.frozen ? o.burstAt : null,
      closureReviewed: o.closingSince !== null && o.closureReviewedFor?.getTime() === o.closingSince.getTime(),
    }
  }

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
        .sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime())
        .map(e => ({
          entryId: e.entryId,
          storyId: e.storyId,
          title: e.title,
          label: story(e.storyId).label,
          summary: story(e.storyId).summary,
          date: e.date,
          role: e.role,
          locked: false,
        })),
      closingStoryId: o.status === 'closing' ? o.closingStoryId : null,
    }
  }

  return {
    safeguards,
    closings: async (): Promise<CloseCase[]> =>
      [...sandbox.overviews.values()].flatMap(o =>
        (o.status === 'open' || o.status === 'quiet') && !o.frozen
          ? activeEntries(o)
              .filter(e => e.reportsEndEvent && !e.closeChecked)
              .map(e => ({
                overviewId: o.id,
                charter: o.charter,
                story: story(e.storyId),
                entries: activeEntries(o)
                  .filter(x => x.storyId !== e.storyId && x.datePublished.getTime() <= e.datePublished.getTime())
                  .sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime())
                  .slice(0, 5)
                  .map(x => ({ title: x.title, date: x.date })),
              }))
          : [],
      ),
    states: async () => [...sandbox.overviews.values()].filter(o => activeEntries(o).length > 0).map(state),
    reviewCase,
    auditPicks: async () => [],
    standsCases: async (): Promise<StandsCase[]> =>
      [...sandbox.overviews.values()]
        .filter(o => o.scope === 'ongoing' && !o.frozen)
        .map(o => {
          const entries = activeEntries(o).sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime())
          return {
            overviewId: o.id,
            title: o.title,
            entries: entries.map(e => ({ storyId: e.storyId, title: e.title, date: e.date, role: e.role })),
            members: facts(entries.map(e => e.storyId)),
            lastSignature: o.lastSignature,
          }
        }),
    applyClosing: async (c, result) => {
      const o = get(c.overviewId)!
      if (result.outcome !== 'failed') for (const e of o.entries) if (e.storyId === c.story.id) e.closeChecked = true
      if (result.outcome === 'closing' && (o.status === 'open' || o.status === 'quiet') && !o.frozen)
        Object.assign(o, { status: 'closing', closingSince: c.story.datePublished, closingStoryId: c.story.id })
      else if (result.outcome !== 'failed') fired(`closing refused (${result.outcome})`)
    },
    applyStatus: async (s, moves, clock) => {
      const o = get(s.id)!
      for (const m of moves) {
        if (m.kind === 'detach') sandbox.detach(m.storyId)
        else if (m.kind === 'scope' && o.scope === m.from) o.scope = m.to
        else if (m.kind === 'status' && o.status === m.from && !o.frozen) {
          if (m.reason === 'closing_cancelled') fired('closing cancelled by a new entry')
          if (m.to === 'closed') Object.assign(o, { status: 'closed', closedAt: clock, closedReason: m.reason })
          else if (m.to === 'open') Object.assign(o, { status: 'open', closedAt: null, closedReason: null, closingSince: null })
          else o.status = m.to
        }
      }
    },
    applyBurst: async s => {
      const o = get(s.id)!
      if (o.frozen) return
      Object.assign(o, { frozen: true, burstAt: now() })
      fired('burst froze an overview')
    },
    applyReview: async (c, result, at) => {
      const o = get(c.overviewId)!
      if (result.outcome !== 'reviewed') return
      for (const a of result.actions) {
        if (a.kind === 'detach') {
          sandbox.detach(a.storyId)
          fired('review detached an entry')
        } else if (a.kind === 'relabel') {
          for (const e of o.entries) if (e.entryId === a.entryId) e.role = a.to
          fired('review relabeled a role')
        } else if (a.kind === 'narrow') {
          o.charter = a.charter
          fired('review narrowed the charter')
        } else if (a.kind === 'retitle') o.title = a.to
        else o.frozen = false
      }
      if (result.refusals.length > 0) safeguards.set('review answers refused', (safeguards.get('review answers refused') ?? 0) + result.refusals.length)
      if (result.trigger === 'closure') o.closureReviewedFor = o.closingSince
      if (result.cancelsClosing && o.status === 'closing') {
        Object.assign(o, { status: 'open', closingSince: null })
        fired('closing cancelled by its review')
      }
      Object.assign(o, { scope: result.scope, entriesAtLastReview: result.kept, reviewedAt: at, burstAt: null })
    },
    applyAudit: async () => {},
    applyStands: async (c, result, signature, today) => {
      const o = get(c.overviewId)!
      if (signature !== null) o.lastSignature = signature
      if (result.outcome === 'written') o.stands = { sentences: result.sentences, doing: result.doing, asOf: today }
      if (result.outcome === 'too_few_facts') o.stands = null
    },
  }
}
