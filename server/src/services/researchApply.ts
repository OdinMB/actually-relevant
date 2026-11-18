/**
 * Turning a research run into the story's state, and back (`.context/story-research.md`, "Applying a
 * run" and "The pipeline step"). An apply writes the run's researched texts and emotion tag into the
 * story's own columns (`researchSwap.ts`), keeps what they held in `pre_research`, written once so
 * that a revert always returns to the single-source analysis, and stores the cited version readers see in
 * `research`. A revert writes the snapshot back and clears both. Each write goes through
 * `recordAnalysis('research', …)` with a fresh embedding, fenced on the status and on `updatedAt` as
 * read before the embedding call, so a status is never moved by a write here, and an editor's move or
 * edit made meanwhile wins. Applying is refused only while research is switched off or research
 * passes are switched on (`applyRefusal`); reverting never is. An editor applies a completed run (`applyResearchRun`); the
 * research step applies its run's verdict once the run's result is stored and before the run is
 * finished (`applyVerdict`), fenced on the story as read before the run started, rejecting through
 * `transition`. An editor's refusals are ServiceErrors; the research step's are outcomes. A revert
 * marks every article version reverted in the same write; an undo puts the version before the
 * current update back on the story (`undoUpdate`).
 */
import { Prisma, type RejectionReason, type StoryStatus } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { generateEmbeddingForContent } from './embedding.js'
import type { GateKind } from './researchChecks.js'
import { buildResearchedStory, researchedStorySchema, type ResearchedStory, type ResearchRunForReaders } from './researchedStory.js'
import { replacedByPasses } from './researchPassQueue.js'
import type { ResearchSource, StoryResearch } from './researchPipeline.js'
import type { StoredResearch } from './researchRuns.js'
import {
  appliedDraftSchema,
  researchedValues,
  restoredValues,
  snapshotForApply,
  SWAPPED_SELECT,
  type AppliedDraft,
  type SwappedValues,
} from './researchSwap.js'
import { fetchSourceFaviconsInBackground, type SourceIconHint } from './sourceFavicons.js'
import { analysisFrom, recordAnalysis, transition, type Actor, type AnalysisRow } from './storyLifecycle.js'
import { undoPlan, versionValues } from './articleVersions.js'
import { revertAllVersions, swapForUndo } from './articleVersionWrites.js'
import { storyVersions } from './passRecords.js'

const log = createLogger('research-apply')

const STORY_CHANGED = 'The story changed while this was written; reload it and try again'

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

/** The story's columns a research write reads and keeps; also the research pass's apply's (`researchPassApply.ts`). */
export const storyColumns = (storyId: string) =>
  prisma.story.findUnique({ where: { id: storyId }, select: { status: true, updatedAt: true, preResearch: true, ...SWAPPED_SELECT } })

export type StoryColumns = NonNullable<Awaited<ReturnType<typeof storyColumns>>>

async function loadStory(storyId: string): Promise<StoryColumns> {
  const story = await storyColumns(storyId)
  if (!story) throw new NotFoundError('Story not found')
  return story
}

/**
 * The story as read before the slow embedding call (the research step: before its run): the write
 * lands only if neither has moved on.
 */
export type ReadState = { status: StoryStatus; updatedAt: Date }

/** Why a story at `status` takes no research write (the stage's statuses: analyzed, selected, published, rejected); null when it takes one. */
function statusRefusal(status: StoryStatus, action: 'take a researched version' | 'be reverted'): string | null {
  if (analysisFrom('research', 'editor').includes(status)) return null
  if (status === 'trashed') return `A trashed story cannot ${action}: restore it first`
  return `Only analyzed, selected, published or rejected stories can ${action}; this one is ${status}`
}

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

/** Each cited outside source's host, with the icon address the search gave for it (tried first). */
function iconHints(research: ResearchedStory, sources: ResearchSource[]): SourceIconHint[] {
  const favicons = new Map(sources.map(s => [s.id, s.favicon]))
  return research.sources.flatMap(s => (s.host ? [{ host: s.host, favicon: favicons.get(s.id) ?? null }] : []))
}

/**
 * The swapped columns and both versions in one lifecycle write, with the embedding of the text
 * written; false when the story changed since `read`: another status, or any write since (an
 * editor's save during the embedding call, which the snapshot and values here would overwrite).
 * `also` runs in the same transaction once the row is written (a research pass's rows); a throw
 * there rolls the write back. The research pass's apply writes through it too.
 */
export async function write(
  storyId: string,
  actor: Actor,
  read: ReadState,
  values: SwappedValues,
  versions: Pick<Prisma.StoryUncheckedUpdateManyInput, 'research' | 'preResearch'>,
  also?: AnalysisRow['also'],
): Promise<boolean> {
  // A slow external call, before the transaction; it throws on failure, and nothing is written
  const embedding = await generateEmbeddingForContent({
    title: values.title,
    titleLabel: values.titleLabel,
    summary: values.summary,
    embeddingContentHash: null,
  })
  const row: AnalysisRow = { id: storyId, data: { ...values, ...versions }, where: { updatedAt: read.updatedAt }, embedding, ...(also ? { also } : {}) }
  const outcomes = await recordAnalysis('research', actor, [row], new Map([[storyId, read.status]]))
  return outcomes.get(storyId) !== 'skipped'
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

/**
 * The write both applies share: the cited version built from `run`, the single-source snapshot
 * (taken once), the researched texts, against `status` and the `updatedAt` in `story`. Then the
 * outlets' favicons are fetched in the background; the page shows each outlet's initial until its
 * icon is stored. Why not, when this story cannot take the version or changed before the write, or
 * research passes were switched on (a research step's run in flight then is not applied either).
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
  if (!(await write(storyId, actor, read, researchedValues(run.draft), { research: asJson(research), preResearch: asJson(preResearch) }))) {
    return { refused: STORY_CHANGED }
  }
  void fetchSourceFaviconsInBackground(iconHints(research, run.sources))
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
 * The rejection reason of each verdict that rejects: only what research found against the story.
 * `research-rating` rejects nothing (owner decision 2026-11-12): its reason `research_rating` stays
 * in the database enum, unused by the pipeline.
 */
export const REJECTED_FOR = {
  stale: 'stale',
  contradicted: 'contradicted',
} as const satisfies Partial<Record<GateKind, RejectionReason>>

export const rejects = (kind: GateKind): kind is keyof typeof REJECTED_FOR => kind in REJECTED_FOR

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
 * story, which keeps its own rating; `stale` and `contradicted` reject it through `transition`,
 * which takes only a selected story; `fallback` changes nothing. The caller leaves it uncalled once
 * the step was switched off during the run (`jobs/researchStories.ts`). Never throws a refusal; an
 * embedding or database error throws.
 */
export async function applyVerdict(storyId: string, runId: string, read: ReadState, result: StoryResearch): Promise<VerdictOutcome> {
  const { verdict } = result
  if (verdict.kind === 'fallback') return 'single-source'

  if (rejects(verdict.kind)) {
    const reason = REJECTED_FOR[verdict.kind]
    // Checked first for the log's reason; the move is fenced on `read` too
    const changed = whyChanged(await storyColumns(storyId), read)
    const moved =
      !changed && (await transition([storyId], { to: 'rejected', reason }, 'pipeline', { where: { updatedAt: read.updatedAt } })).moved.includes(storyId)
    const outcome = moved ? 'rejected' : 'skipped'
    log.info(
      { storyId, runId, reason, outcome, ...(outcome === 'skipped' ? { why: changed ?? 'the story changed during the run' } : {}) },
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

/** Why the story is no longer as `read` before the run (deleted, moved, or written: an editor's edit or apply), or null. */
export function whyChanged(story: StoryColumns | null, read: ReadState): string | null {
  if (!story) return 'the story was deleted during the run'
  if (story.status !== read.status) return `the story moved to ${story.status} during the run`
  if (story.updatedAt.getTime() !== read.updatedAt.getTime()) return 'the story was edited or given research during the run'
  return null
}

/** The research step's write of a kept run, or why it left the story alone: changed during the run (`whyChanged`), or no version readers can be given. */
async function putKeptRun(storyId: string, read: ReadState, run: ApplicableRun): Promise<string | null> {
  const story = await storyColumns(storyId)
  // Checked before the embedding call, which a story that changed does not need; the write is fenced on `read` too
  const changed = whyChanged(story, read)
  if (changed || !story) return changed
  return (await putResearch(storyId, 'pipeline', story, read.status, run))?.refused ?? null
}

/**
 * Give the story its single-source analysis back: the snapshot's values, both versions cleared, an
 * embedding of the restored text, written against the status and `updatedAt` read now (409 when
 * either moved on), whatever `applyRefusal` says. 404 for an unknown story;
 * 409 without a researched version, for a trashed story or one not yet analyzed, and for a snapshot
 * that cannot be read (a re-assessment then replaces the researched version).
 */
export async function revertResearch(storyId: string): Promise<void> {
  const story = await loadStory(storyId)
  if (story.preResearch === null) throw new ConflictError('This story has no researched version to revert')
  const refusal = statusRefusal(story.status, 'be reverted')
  if (refusal) throw new ConflictError(refusal)
  const restored = restoredValues(story.preResearch)
  if (!restored) {
    log.error({ storyId }, 'single-source snapshot does not match its schema; not reverted')
    throw new ConflictError('The saved single-source version cannot be read; re-assess the story to replace its researched version')
  }

  const read = { status: story.status, updatedAt: story.updatedAt }
  // Every article version is reverted in the same write: none is current, and no Update is shown
  const reverted = await write(storyId, 'editor', read, restored, { research: Prisma.DbNull, preResearch: Prisma.DbNull }, tx => revertAllVersions(tx, storyId))
  if (!reverted) throw new ConflictError(STORY_CHANGED)
  log.info({ storyId }, 'research reverted')
}

/**
 * An editor undoes the current update ("Undo this update", the newest version only): the version
 * before it goes back on the story's columns and projection through the same fenced write as an
 * apply, the single-source snapshot kept, and the update is reverted, which takes its Update off the
 * page; the facts its pass demoted are back in use (`swapForUndo`). 404 for an unknown story; 409 for a status that takes no research write, when there is no
 * update to undo (`undoPlan`), and when the story or its versions changed before the write.
 */
export async function undoUpdate(storyId: string): Promise<void> {
  const story = await loadStory(storyId)
  const refusal = statusRefusal(story.status, 'take a researched version')
  if (refusal) throw new ConflictError(refusal)
  const plan = undoPlan(await storyVersions(prisma, storyId))
  if ('refused' in plan) throw new ConflictError(plan.refused)
  const { current, previous } = plan

  const read = { status: story.status, updatedAt: story.updatedAt }
  const swap = (tx: Prisma.TransactionClient) => swapForUndo(tx, storyId, { current: current.id, previous: previous.id, passId: current.passId })
  if (!(await write(storyId, 'editor', read, versionValues(previous), { research: asJson(previous.research) }, swap))) throw new ConflictError(STORY_CHANGED)
  log.info({ storyId, undone: current.number, restored: previous.number }, 'research update undone')
}
