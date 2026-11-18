/**
 * The admin's read of research passes (`.context/research-passes.md`, "Admin routes"): this month's
 * spend under the one cap and whether an editor's pass may start now, and one story's passes,
 * article versions, evidence pool and legacy research runs, which the pass view shows (plan phase 5).
 * Each read marks cut-off passes first, as research's list does; nothing else is written.
 */
import type { PassKind, PassStatus, ResearchRunTrigger } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { NotFoundError } from '../utils/errors.js'
import { loadPool, storyVersions, type StoredVersion } from './passRecords.js'
import { PASS_EVAL_GATE } from './researchPassGate.js'
import { passStepState } from './researchPassQueue.js'
import { editorRefusal, markInterruptedPasses, passCeilingUsd } from './researchPassRuns.js'
import type { Pool } from './researchPool.js'
import { listResearchRuns, type ResearchRunView } from './researchRuns.js'
import { monthToDateUsd } from './researchSpend.js'

export interface PassUsageView {
  /** Every research run and pass started this UTC month, running reservations included. */
  spentUsd: number
  capUsd: number
  /** What a first and a later pass reserve when they start. */
  firstPassUsd: number
  laterPassUsd: number
  /** Why no editor's pass can start now, whatever the story; null while one can. */
  refusal: string | null
  /**
   * The step is switched on: its eval gate open and its job enabled. The admin offers "Research again"
   * in place of Research and Gather context only then (closed with `refusal` while, say, the key is
   * unset), so nothing of the step shows while the gate is closed.
   */
  on: boolean
}

export async function passUsage(now: Date = new Date()): Promise<PassUsageView> {
  await markInterruptedPasses(prisma, now)
  const [spentUsd, refusal, step] = await Promise.all([monthToDateUsd(prisma, now), editorRefusal(), passStepState()])
  return {
    spentUsd,
    capUsd: config.research.monthlyCapUsd,
    firstPassUsd: passCeilingUsd('first'),
    laterPassUsd: passCeilingUsd('later'),
    refusal,
    on: PASS_EVAL_GATE === null && step.enabled,
  }
}

/** One pass as the admin lists it: its row, with its record (searches made, checks, judgments, cards). */
export interface PassView {
  id: string
  number: number
  trigger: ResearchRunTrigger
  kind: PassKind
  status: PassStatus
  outcome: string | null
  verdict: string | null
  costUsd: number
  modelUsd: number
  tavilyCredits: number
  error: string | null
  startedAt: string
  finishedAt: string | null
  /** The article version it produced, or null. */
  versionId: string | null
  record: unknown
}

export interface StoryPassesView {
  /** Newest first. */
  passes: PassView[]
  /** Newest first, reverted ones included. */
  versions: StoredVersion[]
  pool: Pool
  /** The story's research runs from before passes, read-only. */
  legacyRuns: ResearchRunView[]
}

/** The story's passes, versions, pool and legacy runs; 404 for an unknown story. */
export async function storyPasses(storyId: string, now: Date = new Date()): Promise<StoryPassesView> {
  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { id: true } })
  if (!story) throw new NotFoundError('Story not found')
  await markInterruptedPasses(prisma, now)
  const [rows, versions, pool, legacyRuns] = await Promise.all([
    prisma.researchPass.findMany({ where: { storyId }, orderBy: [{ number: 'desc' }] }),
    storyVersions(prisma, storyId),
    loadPool(prisma, storyId),
    listResearchRuns(storyId, now),
  ])
  const passes = rows.map(p => ({
    id: p.id,
    number: p.number,
    trigger: p.trigger,
    kind: p.kind,
    status: p.status,
    outcome: p.outcome,
    verdict: p.verdict,
    costUsd: p.costUsd,
    modelUsd: p.modelUsd,
    tavilyCredits: p.tavilyCredits,
    error: p.error,
    startedAt: p.startedAt.toISOString(),
    finishedAt: p.finishedAt?.toISOString() ?? null,
    versionId: p.versionId,
    record: p.record,
  }))
  return { passes, versions, pool, legacyRuns }
}
