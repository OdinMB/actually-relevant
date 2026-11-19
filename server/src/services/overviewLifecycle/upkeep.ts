/**
 * The upkeep's writes after linking (`.context/overviews.md`, "Status, closing and reviews"): each the
 * plan `overviewPlans.ts` makes from the overview's rows, read and locked in the same transaction, and
 * the stands refreshes, which change no overview row.
 */
import { randomUUID } from 'node:crypto'
import prisma from '../../lib/prisma.js'
import { applied, type Rows } from '../overviewChanges.js'
import type { CloseCase, CloseResult } from '../overviewClose.js'
import type { StandsInputs } from '../overviewDecisions.js'
import { PIPELINE, planAudit, planBurst, planClosing, planReview, planStatus, type PlanContext } from '../overviewPlans.js'
import type { AuditResult, ReviewCase, ReviewResult } from '../overviewReview.js'
import type { StandsResult } from '../overviewStands.js'
import type { StatusMove } from '../overviewStatus.js'
import type { OverviewState } from '../overviewTypes.js'
import type { StandsCase } from '../overviewUpkeep.js'
import { forgetOverviewLinks } from '../overviewCaches.js'
import { applyPlan, json, readRows } from './apply.js'

const context = (now: Date): PlanContext => ({ now, newId: randomUUID })

/** An end-event check's result (`planClosing`): the story's `close` decision, and on agreement the closing begun. */
export async function applyClosing(c: CloseCase, result: CloseResult, now: Date = new Date(), db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async tx => {
    const rows = await readRows(tx, c.overviewId)
    await applyPlan(tx, rows, planClosing(rows?.overview ?? null, c, result, context(now)), now)
  })
}

/** The status machine's moves for one overview (`planStatus`), each its own `status` decision, planned on the rows the one before left. */
export async function applyStatus(
  state: OverviewState,
  moves: readonly StatusMove[],
  clock: Date,
  now: Date = new Date(),
  db: typeof prisma = prisma,
): Promise<void> {
  const removed = await db.$transaction(async tx => {
    let rows: Rows | null = await readRows(tx, state.id)
    if (!rows) return false
    let removedAny = false
    for (const p of planStatus(rows, moves, clock, context(now))) {
      removedAny = (await applyPlan(tx, rows, p, now)).removed || removedAny
      rows = applied(rows, p)
    }
    return removedAny
  })
  if (removed) forgetOverviewLinks()
}

/** A burst (`planBurst`): the overview frozen until its burst review, as a `frozen` status decision. */
export async function applyBurst(state: OverviewState, now: Date = new Date(), db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(async tx => {
    const rows = await readRows(tx, state.id)
    const p = rows ? planBurst(rows.overview, state, context(now)) : null
    if (rows && p) await applyPlan(tx, rows, p, now)
  })
}

/** A review's result (`planReview`), as its `review` decision; nothing for an overview gone meanwhile. */
export async function applyReview(c: ReviewCase, result: ReviewResult, now: Date = new Date(), db: typeof prisma = prisma): Promise<void> {
  const removed = await db.$transaction(async tx => {
    const rows = await readRows(tx, c.overviewId)
    if (!rows) return false
    return (await applyPlan(tx, rows, planReview(rows, c, result, context(now)), now)).removed
  })
  if (removed) forgetOverviewLinks()
}

/** The monthly audit's findings (`planAudit`), never applied. */
export async function applyAudit(c: ReviewCase, result: AuditResult, now: Date = new Date(), db: typeof prisma = prisma): Promise<void> {
  await db.$transaction(tx => applyPlan(tx, null, planAudit(c, result, context(now)), now))
}

/** What a stands refresh records of its inputs (`StandsInputs`): the signature it was made for (none for a failed one), the marker and the day its offer next changes. */
export interface StandsRecord {
  signature: string | null
  marker: string | null
  until: string | null
}

/**
 * A stands refresh (`.context/overviews.md`, "Where this stands"), logged as a `stands` decision with
 * its record (`StandsRecord`). A version written becomes the one current version, the previous one
 * superseded; with too few facts the current version is superseded and none replaces it; when nothing
 * survived the checks the previous one stays.
 */
export async function applyStands(c: StandsCase, result: StandsResult, record: StandsRecord, today: string, db: typeof prisma = prisma): Promise<void> {
  const checks = { drops: result.drops, checked: result.checked, failed: result.failed }
  const inputs: StandsInputs = { ...record, offered: result.offered.map(o => o.id), ...checks }
  await db.$transaction(async tx => {
    await tx.overviewDecision.create({
      data: {
        kind: 'stands',
        overviewId: c.overviewId,
        outcome: result.outcome,
        inputs: json(inputs),
        model: result.model,
        promptVersion: result.promptVersion,
        costUsd: result.costUsd,
        actor: PIPELINE,
      },
    })
    if (result.outcome !== 'written' && result.outcome !== 'too_few_facts') return
    await tx.overviewStands.updateMany({ where: { overviewId: c.overviewId, status: 'current' }, data: { status: 'superseded' } })
    if (result.outcome !== 'written') return
    const last = await tx.overviewStands.findFirst({ where: { overviewId: c.overviewId }, orderBy: { number: 'desc' }, select: { number: true } })
    await tx.overviewStands.create({
      data: {
        overviewId: c.overviewId,
        number: (last?.number ?? 0) + 1,
        sentences: json(result.sentences),
        doing: json(result.doing),
        factsSeen: json(result.offered.map(o => ({ id: o.id, storyId: o.storyId, ref: o.ref, current: o.current }))),
        asOf: new Date(`${today}T00:00:00Z`),
        model: result.model ?? '',
        promptVersion: result.promptVersion,
        record: json(checks),
      },
    })
  })
}
