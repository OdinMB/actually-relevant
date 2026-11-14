/**
 * The stories list's bulk "Use researched versions" (`.context/story-research.md`, "Bulk apply"): for
 * each story an editor selected, the run its research section offers by default, put on the story
 * through the single "Use this version" (`applyResearchRun`, with every gate, refusal and fence it
 * has), one story at a time in the order chosen. The section opens on the story's newest run
 * (`newestResearchRun`) and offers "Use this version" only for a completed run with a draft that did
 * not fall back (the client's `canUseVersion`); so does this, and it never reaches past the newest
 * run. A story is skipped with why: another task is processing it, its newest run is not one the
 * section offers, the story already shows that run's version, or the apply refuses it. The batch is
 * refused whole only while no run can be applied (`applyRefusal`). Each apply makes one embedding
 * call and no model call.
 */
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { ConflictError, ServiceError } from '../utils/errors.js'
import type { GateKind } from './researchChecks.js'
import { applyRefusal, applyResearchRun } from './researchApply.js'
import { PROCESSING } from './researchBatch.js'
import { newestResearchRun, sanitizedError, type ResearchRunView } from './researchRuns.js'
import { appliedDraftSchema, researchedValues, SWAPPED_SELECT, swappedEdits, type SwappedValues } from './researchSwap.js'

const log = createLogger('research-apply')

/**
 * What became of one chosen story: its newest run applied, with research's verdict on it (an editor
 * may overrule `stale` and `contradicted`, as "Use this version" allows); skipped, with why; or
 * failed on an unexpected error, named by the error's name only.
 */
export type BulkApplyOutcome =
  { storyId: string; outcome: 'applied'; runId: string; verdict: GateKind } | { storyId: string; outcome: 'skipped' | 'failed'; reason: string }

type Offered = { runId: string; verdict: GateKind; draft: unknown }

/** The newest run's version when the story's research section offers "Use this version" for it, else why not. */
function offeredVersion(run: ResearchRunView | null): Offered | { refused: string } {
  if (!run) return { refused: 'No research run yet' }
  if (run.status === 'running') return { refused: 'Its newest run is still running' }
  if (run.status !== 'completed') return { refused: run.error ? `Its newest run failed (${run.error})` : 'Its newest run failed' }
  if (run.result?.verdict.kind === 'fallback') return { refused: "Its newest run fell back to today's format: it has no researched version" }
  if (!run.result?.draft) return { refused: 'Its newest run wrote no draft to apply' }
  return { runId: run.id, verdict: run.result.verdict.kind, draft: run.result.draft }
}

/** Whether the story already shows the draft's version: it is researched, and each column an apply of the draft writes holds that value. */
function showsVersion(story: SwappedValues & { preResearch: unknown }, draft: unknown): boolean {
  if (story.preResearch == null) return false
  const parsed = appliedDraftSchema.safeParse(draft)
  return parsed.success && swappedEdits(researchedValues(parsed.data), story).length === 0
}

/** One story's newest run applied, or why not; never throws. */
async function applyNewest(storyId: string): Promise<BulkApplyOutcome> {
  const skipped = (reason: string): BulkApplyOutcome => ({ storyId, outcome: 'skipped', reason })
  try {
    const story = await prisma.story.findUnique({ where: { id: storyId }, select: { preResearch: true, ...SWAPPED_SELECT } })
    if (!story) return skipped('Story not found')
    const offered = offeredVersion(await newestResearchRun(storyId))
    if ('refused' in offered) return skipped(offered.refused)
    if (showsVersion(story, offered.draft)) return skipped('Its newest run is already applied')
    await applyResearchRun(storyId, offered.runId)
    return { storyId, outcome: 'applied', runId: offered.runId, verdict: offered.verdict }
  } catch (err) {
    if (err instanceof ServiceError) return skipped(err.message)
    const reason = sanitizedError(err)
    log.error({ storyId, error: reason }, 'bulk apply failed on a story; going on with the next')
    return { storyId, outcome: 'failed', reason }
  }
}

/**
 * Put each chosen story's newest run on it, one story at a time in the order chosen, and say what
 * became of each: 409 while `applyRefusal` gives a reason. A story another task is processing is
 * skipped, as every bulk action skips one; a story chosen twice is taken once.
 */
export async function applyNewestRuns(storyIds: string[]): Promise<{ outcomes: BulkApplyOutcome[] }> {
  const closed = applyRefusal()
  if (closed) throw new ConflictError(closed)
  const processing = new Set(taskRegistry.getProcessingStoryIds())
  const outcomes: BulkApplyOutcome[] = []
  for (const storyId of new Set(storyIds)) {
    outcomes.push(processing.has(storyId) ? { storyId, outcome: 'skipped', reason: PROCESSING } : await applyNewest(storyId))
  }
  const count = (outcome: BulkApplyOutcome['outcome']) => outcomes.filter(o => o.outcome === outcome).length
  log.info({ applied: count('applied'), skipped: count('skipped'), failed: count('failed') }, 'bulk apply finished')
  return { outcomes }
}
