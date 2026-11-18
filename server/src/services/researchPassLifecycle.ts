/**
 * A research pass's row through its life (`.context/research-passes.md`, "Running a pass"), and the
 * only writer of `research_passes` (a fence test holds it, `test/passWriters.test.ts`): the claim,
 * which under research's reservation lock marks the passes a restart cut off, imports the story's
 * legacy runs into its pool once (`importLegacyPool`), decides the pass's kind and writes it `running`
 * at its ceiling against the one monthly cap (`researchSpend.ts`); a pass that never started, written
 * `skipped` at $0; the settling of a running pass, with its rows (`passWrites.ts`) in the caller's
 * transaction (`storePassResult`), skipped (a story the loader cannot research) or failed outside its
 * run; and the cut-off passes marked failed. Every move from `running` is fenced on it, so a pass a
 * restart marked cut off is never settled again.
 */
import type { Prisma, ResearchRunTrigger } from '@prisma/client'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { sanitizedError } from '../lib/runErrors.js'
import { importLegacyPool, legacyPoolPresent, readLegacyImport } from './legacyPool.js'
import { storePassRows, type PassWrite } from './passWrites.js'
import { passStaleBefore } from './researchPassQueue.js'
import { monthToDateUsd, RESEARCH_RESERVATION_LOCK } from './researchSpend.js'

const log = createLogger('research_pass')

export const PASS_INTERRUPTED = 'interrupted: the server restarted during the pass'

type Db = Parameters<typeof monthToDateUsd>[0]

/** What a pass of each kind reserves when it starts: its ceiling (`config.research.pass`). */
export const passCeilingUsd = (kind: 'first' | 'later') => (kind === 'first' ? config.research.pass.firstPassUsd : config.research.pass.laterPassUsd)

/** A `running` pass a restart cut off (`passStaleBefore`): failed, `technical`, keeping its cost (its reservation). Each settles its story. */
export async function markInterruptedPasses(db: Db = prisma, now: Date = new Date()): Promise<number> {
  const { count } = await db.researchPass.updateMany({
    where: { status: 'running', startedAt: { lt: passStaleBefore(now) } },
    data: { status: 'failed', outcome: 'technical', error: PASS_INTERRUPTED, finishedAt: now },
  })
  return count
}

export interface PassClaim {
  passId: string
  kind: 'first' | 'later'
  ceilingUsd: number
}

export type Claim = PassClaim | { refused: 'in-progress' } | { refused: 'cap'; spentUsd: number; ceilingUsd: number }

/**
 * The kind of pass the story gets: `later` while it has a current version to judge, else `first`
 * (a story whose first passes kept no article gets a first pass again). The one rule a claim and a
 * skipped pass record.
 */
async function passKindOf(tx: Pick<Prisma.TransactionClient, 'articleVersion'>, storyId: string): Promise<'first' | 'later'> {
  return (await tx.articleVersion.count({ where: { storyId, status: 'current' } })) > 0 ? 'later' : 'first'
}

/** The next number of the story's passes. */
async function nextNumber(tx: Prisma.TransactionClient, storyId: string): Promise<number> {
  const top = await tx.researchPass.aggregate({ where: { storyId }, _max: { number: true } })
  return (top._max.number ?? 0) + 1
}

/**
 * Claim a pass of the story, under research's reservation lock, so concurrent starts (the step's, an
 * editor's, a research run's) never pass the cap or run one story twice: cut-off passes marked first,
 * the legacy runs imported into the pool once (read before the lock, read again under it when the
 * story was edited meanwhile, written under it), then the pass
 * row written `running` at its ceiling. Its kind is `passKindOf`'s once the import ran, so a story
 * researched before passes gets a later pass against version 1.
 */
export async function claimPass(storyId: string, trigger: ResearchRunTrigger, now: Date = new Date()): Promise<Claim> {
  // The import's reads before the lock every claim and research start waits on; it checks again under it
  const legacy = (await legacyPoolPresent(prisma, storyId)) ? undefined : await readLegacyImport(prisma, storyId)
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESEARCH_RESERVATION_LOCK}::bigint)`
      await markInterruptedPasses(tx, now)
      if ((await tx.researchPass.count({ where: { storyId, status: 'running' } })) > 0) return { refused: 'in-progress' as const }
      await importLegacyPool(tx, storyId, legacy)
      const kind = await passKindOf(tx, storyId)
      const ceilingUsd = passCeilingUsd(kind)
      const spentUsd = await monthToDateUsd(tx, now)
      if (spentUsd + ceilingUsd > config.research.monthlyCapUsd) return { refused: 'cap' as const, spentUsd, ceilingUsd }
      const pass = await tx.researchPass.create({
        data: { storyId, number: await nextNumber(tx, storyId), trigger, kind, status: 'running', costUsd: ceilingUsd, startedAt: now },
        select: { id: true },
      })
      return { passId: pass.id, kind, ceilingUsd }
    },
    { timeout: config.database.transactionTimeoutMs },
  )
}

/**
 * A pipeline pass that never started (the cap reached, a story the loader cannot research): `skipped`
 * at $0 with its reason, so it settles the story without counting against the cap. Returns its id.
 */
export async function recordSkippedPass(storyId: string, reason: string, now: Date = new Date()): Promise<string> {
  return prisma.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESEARCH_RESERVATION_LOCK}::bigint)`
      const number = await nextNumber(tx, storyId)
      const kind = await passKindOf(tx, storyId)
      const pass = await tx.researchPass.create({
        data: {
          storyId,
          number,
          trigger: 'pipeline',
          kind,
          status: 'skipped',
          outcome: 'budget',
          costUsd: 0,
          error: `skipped: ${reason}`,
          startedAt: now,
          finishedAt: now,
        },
        select: { id: true },
      })
      log.info({ passId: pass.id, storyId, reason }, 'research pass step skipped a story')
      return pass.id
    },
    { timeout: config.database.transactionTimeoutMs },
  )
}

/** A claimed pass whose story the loader cannot research: `skipped` at $0 with its reason, while it still runs. */
export async function skipClaimedPass(passId: string, reason: string, now: Date = new Date()): Promise<void> {
  await prisma.researchPass.updateMany({
    where: { id: passId, status: 'running' },
    data: { status: 'skipped', outcome: 'fallback', costUsd: 0, error: `skipped: ${reason}`, finishedAt: now },
  })
}

/** Fail a claimed pass outside its run, keeping its reservation as its cost; never throws. */
export async function failPass(passId: string, error: string): Promise<void> {
  await prisma.researchPass
    .updateMany({ where: { id: passId, status: 'running' }, data: { status: 'failed', outcome: 'technical', error, finishedAt: new Date() } })
    .catch((e: unknown) => log.error({ passId, error: sanitizedError(e) }, 'could not mark the research pass failed'))
}

/**
 * Settle one pass with its result in the caller's transaction, while it is still `running` (false,
 * and nothing written, once a restart marked it cut off): the pass row's columns from its result, then
 * its rows (`storePassRows`), and the pass row pointed at the version it made.
 */
export async function storePassResult(tx: Prisma.TransactionClient, w: PassWrite): Promise<boolean> {
  const { count } = await tx.researchPass.updateMany({
    where: { id: w.passId, status: 'running' },
    data: {
      status: w.pass.status,
      outcome: w.pass.outcome,
      verdict: w.pass.verdict,
      costUsd: w.pass.costUsd,
      modelUsd: w.pass.modelUsd,
      tavilyCredits: w.pass.credits,
      record: w.pass.record as Prisma.InputJsonValue,
      error: w.pass.error,
      finishedAt: w.now,
    },
  })
  if (count === 0) return false
  const versionId = await storePassRows(tx, w)
  if (versionId) await tx.researchPass.update({ where: { id: w.passId }, data: { versionId } })
  return true
}
