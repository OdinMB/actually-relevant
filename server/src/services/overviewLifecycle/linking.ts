/**
 * One story's linking written (`.context/overviews.md`, "How a story is linked"): the plan
 * `overviewPlans.ts` makes from the overview's rows, read and locked in the same transaction.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../lib/prisma.js'
import type { Rows } from '../overviewChanges.js'
import { membershipsOf } from '../overviewCandidates.js'
import { isStale, type ApplyOutcome, type LinkResult } from '../overviewLink.js'
import { planAlone, planConflict, planFounding, planJoin, type LinkPlan, type PlanContext } from '../overviewPlans.js'
import { SETTLING_OUTCOMES } from '../overviewTypes.js'
import { applyPlan, readRows, refusedByIndex } from './apply.js'

/**
 * Writes one story's linking. Nothing is written for a story that has an active entry or a settling
 * `link` decision by now (it was linked meanwhile, as a founding partner); a result whose founding
 * partner has joined an overview since, or a founding whose partner waits for a re-center by now
 * (`isStale`), is `stale`, and on its `lastTry` a `conflict`. A join is planned
 * on its overview as it stands now: a `conflict` once it is gone or closed (but faded), `held` once
 * frozen. A write the one-active-entry index refuses (an editor's attach at the same moment) is rolled
 * back and logged as a `conflict`, which the next run retries. `now` is the run's: the entries'
 * `joined_at`, which the burst check counts by.
 */
export async function applyLink(result: LinkResult, lastTry: boolean, now: Date = new Date(), db: typeof prisma = prisma): Promise<ApplyOutcome> {
  const ctx: PlanContext = { now, newId: randomUUID }
  try {
    return await db.$transaction(async tx => {
      const memberships = await membershipsOf(tx, [result.story.id, ...result.shown.partners.map(p => p.id)], undefined, now)
      const settled = await tx.overviewDecision.findFirst({
        where: { storyId: result.story.id, kind: 'link', undoneAt: null, outcome: { in: [...SETTLING_OUTCOMES] } },
        select: { id: true },
      })
      if (memberships.active.has(result.story.id) || settled) return { kind: 'skipped' } as const
      let linked: LinkPlan
      let rows: Rows | null = null
      if (isStale(result, memberships)) {
        if (!lastTry) return { kind: 'stale' } as const
        linked = planConflict(result, ctx)
      } else if (result.outcome === 'joined') {
        rows = await readRows(tx, result.join!.candidate.id)
        linked = planJoin(rows?.overview ?? null, result, ctx)
      } else if (result.outcome === 'founded') linked = planFounding(result, ctx)
      else linked = planAlone(result, ctx)
      await applyPlan(tx, rows, linked.plan, now)
      return { kind: 'written', outcome: linked.outcome } as const
    })
  } catch (error) {
    if (!refusedByIndex(error)) throw error
    await db.$transaction(tx => applyPlan(tx, null, planConflict(result, ctx).plan, now))
    return { kind: 'written', outcome: 'conflict' }
  }
}
