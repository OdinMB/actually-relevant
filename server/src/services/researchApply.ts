/**
 * Turning a research run into the story's state (`.context/story-research.md`, "Applying a run" and
 * "The pipeline step"): the legacy research runs' applies, which research passes replace. An apply
 * writes the run's researched texts and emotion tag into the story's own columns
 * (`researchSwap.ts`), keeps what they held in `pre_research`, written once so that a revert always
 * returns to the single-source analysis, and stores the cited version readers see in `research`.
 * Every write goes through `researchWrites.ts`, the story's research writes, fenced on the status and
 * on `updatedAt` (the revert and the undo live there too). Applying is refused only while research is
 * switched off or research passes are switched on (`applyRefusal`). An editor applies a completed run
 * (`applyResearchRun`); the research step applies its run's verdict once the run's result is stored
 * and before the run is finished (`applyVerdict`), fenced on the story as read before the run
 * started. An editor's refusals are ServiceErrors; the research step's are outcomes.
 */
import { type StoryStatus, Prisma } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { buildResearchedStory, researchedStorySchema, type ResearchRunForReaders } from './researchedStory.js'
import { replacedByPasses } from './researchPassQueue.js'
import type { ResearchSource, StoryResearch } from './researchPipeline.js'
import type { StoredResearch } from './researchRuns.js'
import { appliedDraftSchema, researchedValues, snapshotForApply, type AppliedDraft } from './researchSwap.js'
import {
  fencedWrite,
  fetchCitedFavicons,
  loadStory,
  REJECTED_FOR,
  rejectForVerdict,
  rejects,
  statusRefusal,
  STORY_CHANGED,
  storyColumns,
  whyChanged,
  type ReadState,
  type StoryColumns,
} from './researchWrites.js'
import type { Actor } from './storyLifecycle.js'

const log = createLogger('research-apply')

/**
 * Why no run can be applied now, whatever the story, or null: research switched off (no
 * `TAVILY_API_KEY`), or research passes switched on, whose versions an apply would bypass
 * (`replacedByPasses`). Applying has no gate of its own (owner decision 2026-11-14). A revert is never
 * refused for either.
 */
export async function applyRefusal(): Promise<string | null> {
  if (!config.research.tavilyApiKey) return 'Research is switched off: TAVILY_API_KEY is not set, so no run can be applied (reverting still works)'
  return replacedByPasses(REPLACED)
}

/** While research passes are on, a pass researches the story again into a new version. */
const REPLACED = 'a research run is no longer applied (reverting still works)'

/** What an apply writes from: the run's draft, sources and earlier stories. */
type ApplicableRun = ResearchRunForReaders & { draft: AppliedDraft; sources: ResearchSource[] }

/** The run's draft when it has a researched version to apply, else why not. */
function applicableDraft(result: Pick<StoryResearch, 'draft' | 'verdict'> | null): { draft: AppliedDraft } | { refused: string } {
  if (!result?.draft) return { refused: 'This run wrote no draft to apply' }
  if (result.verdict.kind === 'fallback') return { refused: "This run fell back to today's format: it has no researched version to apply" }
  const draft = appliedDraftSchema.safeParse(result.draft)
  if (!draft.success) return { refused: 'This run is from an older format and cannot be applied; research the story again' }
  return { draft: draft.data }
}

/** A completed run of this story with a version to apply, or the editor's 404 or 409. */
async function completedRun(storyId: string, runId: string): Promise<ApplicableRun> {
  const run = await prisma.storyResearchRun.findUnique({ where: { id: runId }, select: { storyId: true, status: true, result: true } })
  if (!run) throw new NotFoundError('Research run not found')
  if (run.storyId !== storyId) throw new ConflictError('This run researched another story')
  if (run.status !== 'completed') throw new ConflictError(`Only a completed run can be applied; this one is ${run.status}`)
  const result = run.result as unknown as StoredResearch | null
  const applicable = applicableDraft(result)
  if ('refused' in applicable) throw new ConflictError(applicable.refused)
  return { draft: applicable.draft, sources: result!.sources, earlier: result!.earlier }
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

/**
 * The write both applies share: the cited version built from `run`, the single-source snapshot
 * (taken once), the researched texts, against `status` and the `updatedAt` in `story`. Then the
 * outlets' favicons are fetched in the background. Why not, when this story cannot take the version
 * or changed before the write, or research passes were switched on (a research step's run in flight
 * then is not applied either).
 */
async function putResearch(storyId: string, actor: Actor, story: StoryColumns, status: StoryStatus, run: ApplicableRun): Promise<{ refused: string } | null> {
  const replaced = await replacedByPasses(REPLACED)
  if (replaced) return { refused: replaced }
  const refusal = statusRefusal(status, 'take a researched version')
  if (refusal) return { refused: refusal }
  const research = buildResearchedStory(run)
  if (!researchedStorySchema.safeParse(research).success) return { refused: "This run's sources do not make a version readers can be given" }
  // Written once: re-applying keeps the snapshot of the single-source analysis
  const preResearch = snapshotForApply(story.preResearch, story)

  const read = { status, updatedAt: story.updatedAt }
  if (!(await fencedWrite(storyId, actor, read, researchedValues(run.draft), { research: asJson(research), preResearch: asJson(preResearch) }))) {
    return { refused: STORY_CHANGED }
  }
  fetchCitedFavicons(research, new Map(run.sources.map(s => [s.id, s.favicon])))
  return null
}

/**
 * An editor puts a completed run's researched version on the story, against the status and the
 * `updatedAt` read now, so an edit saved during the embedding call is kept. 409 first while
 * `applyRefusal` gives a reason. Then 404 for an unknown story or run; 409 for a run of another
 * story, one not completed, without a draft, fallen back or of an older format, for a status outside
 * analyzed, selected, published and rejected, and when the story changed before the write.
 */
export async function applyResearchRun(storyId: string, runId: string): Promise<'applied'> {
  const closed = await applyRefusal()
  if (closed) throw new ConflictError(closed)
  const story = await loadStory(storyId)
  const run = await completedRun(storyId, runId)
  const refused = await putResearch(storyId, 'editor', story, story.status, run)
  if (refused) throw new ConflictError(refused.refused)
  log.info({ storyId, runId, actor: 'editor' }, 'research applied')
  return 'applied'
}

/**
 * What the research step did with a verdict: `applied` (the researched version is on the story),
 * `rejected` (with the verdict's reason), `single-source` (a fallback, or a kept run without a
 * usable draft: the story publishes in today's format), `skipped` (the story moved, was written
 * (an editor's edit or apply) or went during the run, or its sources make no version readers can
 * be given; the editor's state is kept, and the completed run can still be applied by hand).
 */
export type VerdictOutcome = 'applied' | 'rejected' | 'single-source' | 'skipped'

/**
 * Apply the research step's verdict for its run, whose result is stored and which is still
 * `running` (the publish gate keeps the story waiting meanwhile). Every write is fenced on `read`,
 * the story's status and `updatedAt` as read before the run started, so an editor's move, edit or
 * apply during the run always wins: `keep` and `research-rating` put the researched version on the
 * story, which keeps its own rating; `stale` and `contradicted` reject it (`rejectForVerdict`);
 * `fallback` changes nothing. The caller leaves it uncalled once the step was switched off during
 * the run (`jobs/researchStories.ts`). Never throws a refusal; an embedding or database error throws.
 */
export async function applyVerdict(storyId: string, runId: string, read: ReadState, result: StoryResearch): Promise<VerdictOutcome> {
  const { verdict } = result
  if (verdict.kind === 'fallback') return 'single-source'

  if (rejects(verdict.kind)) {
    const { moved, why } = await rejectForVerdict(storyId, verdict.kind, read)
    const outcome = moved ? 'rejected' : 'skipped'
    log.info(
      { storyId, runId, reason: REJECTED_FOR[verdict.kind], outcome, ...(outcome === 'skipped' ? { why: why ?? 'the story changed during the run' } : {}) },
      'research verdict rejects the story',
    )
    return outcome
  }

  const applicable = applicableDraft(result)
  if ('refused' in applicable) {
    log.warn({ storyId, runId, reason: applicable.refused }, 'research kept the story without a draft to apply; it stays single-source')
    return 'single-source'
  }
  const refused = await putKeptRun(storyId, read, { draft: applicable.draft, sources: result.sources, earlier: result.earlier })
  if (refused) {
    log.info({ storyId, runId, reason: refused }, 'research not applied; the completed run can still be applied by hand')
    return 'skipped'
  }
  log.info({ storyId, runId, actor: 'pipeline' }, 'research applied')
  return 'applied'
}

/** The research step's write of a kept run, or why it left the story alone: changed during the run (`whyChanged`), or no version readers can be given. */
async function putKeptRun(storyId: string, read: ReadState, run: ApplicableRun): Promise<string | null> {
  const story = await storyColumns(storyId)
  // Checked before the embedding call, which a story that changed does not need; the write is fenced on `read` too
  const changed = whyChanged(story, read)
  if (changed || !story) return changed
  return (await putResearch(storyId, 'pipeline', story, read.status, run))?.refused ?? null
}
