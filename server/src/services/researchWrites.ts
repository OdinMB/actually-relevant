/**
 * Every write of a story's researched state (`.context/research-passes.md`, "Applying a pass", and
 * `.context/story-research.md`): the one fenced write that puts a researched version's texts and
 * projection on the story, with a fresh embedding, through `recordAnalysis('research', …)`, fenced on
 * the status and on `updatedAt` as read before the embedding call, so a status is never moved by a
 * write here and an editor's move or edit made meanwhile wins; a pipeline verdict's rejection, fenced
 * the same way; the revert to the single-source analysis; the undo of the current update; and the
 * article versions' status writes that go with them in the same transaction (`AnalysisRow.also`).
 * Research passes (`researchPassApply.ts`) and research runs (`researchApply.ts`) both write through
 * it. An editor's refusals are ServiceErrors.
 */
import { Prisma, type RejectionReason, type StoryStatus } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { undoPlan, versionValues } from './articleVersions.js'
import { generateEmbeddingForContent } from './embedding.js'
import { storyVersions } from './passRecords.js'
import type { GateKind } from './researchChecks.js'
import type { ResearchedStory } from './researchedStory.js'
import { restoredValues, SWAPPED_SELECT, type SwappedValues } from './researchSwap.js'
import { fetchSourceFaviconsInBackground } from './sourceFavicons.js'
import { analysisFrom, recordAnalysis, transition, type Actor, type AnalysisRow } from './storyLifecycle.js'

const log = createLogger('research-apply')

export const STORY_CHANGED = 'The story changed while this was written; reload it and try again'

/** The story's columns a research write reads and keeps. */
export const storyColumns = (storyId: string) =>
  prisma.story.findUnique({ where: { id: storyId }, select: { status: true, updatedAt: true, preResearch: true, ...SWAPPED_SELECT } })

export type StoryColumns = NonNullable<Awaited<ReturnType<typeof storyColumns>>>

/** The story's research columns, or the editor's 404. */
export async function loadStory(storyId: string): Promise<StoryColumns> {
  const story = await storyColumns(storyId)
  if (!story) throw new NotFoundError('Story not found')
  return story
}

/**
 * The story as read before the slow embedding call (a pipeline's write: before its run or pass): the
 * write lands only if neither has moved on.
 */
export type ReadState = { status: StoryStatus; updatedAt: Date }

/** Why a story at `status` takes no research write (the stage's statuses: analyzed, selected, published, rejected); null when it takes one. */
export function statusRefusal(status: StoryStatus, action: 'take a researched version' | 'be reverted'): string | null {
  if (analysisFrom('research', 'editor').includes(status)) return null
  if (status === 'trashed') return `A trashed story cannot ${action}: restore it first`
  return `Only analyzed, selected, published or rejected stories can ${action}; this one is ${status}`
}

/** Why the story is no longer as `read` before the run (deleted, moved, or written: an editor's edit or apply), or null. */
export function whyChanged(story: StoryColumns | null, read: ReadState): string | null {
  if (!story) return 'the story was deleted during the run'
  if (story.status !== read.status) return `the story moved to ${story.status} during the run`
  if (story.updatedAt.getTime() !== read.updatedAt.getTime()) return 'the story was edited or given research during the run'
  return null
}

/**
 * The swapped columns and both versions in one lifecycle write, with the embedding of the text
 * written; false when the story changed since `read`: another status, or any write since (an
 * editor's save during the embedding call, which the snapshot and values here would overwrite).
 * `also` runs in the same transaction once the row is written (a research pass's rows, a version
 * status hook); a throw there rolls the write back.
 */
export async function fencedWrite(
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

/**
 * The cited outside sources' favicons, fetched in the background after a write, each host with the
 * icon address held for its source id (tried first); the page shows each outlet's initial until its
 * icon is stored. None for our earlier stories, which have no host.
 */
export function fetchCitedFavicons(research: Pick<ResearchedStory, 'sources'>, favicons: ReadonlyMap<string, string | null>): void {
  void fetchSourceFaviconsInBackground(research.sources.flatMap(s => (s.host ? [{ host: s.host, favicon: favicons.get(s.id) ?? null }] : [])))
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
 * A pipeline verdict against the story rejects it, with the verdict's reason, only while the story is
 * as `read`: checked first, for the reason given when it is not, and the move fenced on `updatedAt`
 * too, through `transition`, which takes only a selected story. `why` is null once it moved, else what
 * changed (null when only the fence saw it).
 */
export async function rejectForVerdict(storyId: string, kind: keyof typeof REJECTED_FOR, read: ReadState): Promise<{ moved: boolean; why: string | null }> {
  const changed = whyChanged(await storyColumns(storyId), read)
  if (changed) return { moved: false, why: changed }
  const { moved } = await transition([storyId], { to: 'rejected', reason: REJECTED_FOR[kind] }, 'pipeline', { where: { updatedAt: read.updatedAt } })
  return { moved: moved.includes(storyId), why: null }
}

const asJson = (value: unknown) => value as Prisma.InputJsonValue

/**
 * Give the story its single-source analysis back: the snapshot's values, both versions cleared, an
 * embedding of the restored text, written against the status and `updatedAt` read now (409 when
 * either moved on), whatever research's or the passes' switches say; every article version is
 * reverted in the same write. 404 for an unknown story; 409 without a researched version, for a
 * trashed story or one not yet analyzed, and for a snapshot that cannot be read (a re-assessment then
 * replaces the researched version).
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
  const reverted = await fencedWrite(storyId, 'editor', read, restored, { research: Prisma.DbNull, preResearch: Prisma.DbNull }, tx =>
    revertAllVersions(tx, storyId),
  )
  if (!reverted) throw new ConflictError(STORY_CHANGED)
  log.info({ storyId }, 'research reverted')
}

/**
 * An editor undoes the current update ("Undo this update", the newest version only): the version
 * before it goes back on the story's columns and projection through the same fenced write, the
 * single-source snapshot kept, and the update is reverted, which takes its Update off the page; the
 * facts its pass demoted are back in use (`swapForUndo`). 404 for an unknown story; 409 for a status
 * that takes no research write, when there is no update to undo (`undoPlan`), and when the story or
 * its versions changed before the write.
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
  if (!(await fencedWrite(storyId, 'editor', read, versionValues(previous), { research: asJson(previous.research) }, swap))) {
    throw new ConflictError(STORY_CHANGED)
  }
  log.info({ storyId, undone: current.number, restored: previous.number }, 'research update undone')
}

// ---------------------------------------------------------------------------
// The article versions' status hooks, each in the transaction of the story write it belongs with
// ---------------------------------------------------------------------------

/** Every version of the story reverted: none is current, and their Updates leave the page (a revert, a re-assess). */
export async function revertAllVersions(tx: Prisma.TransactionClient, storyId: string): Promise<void> {
  await tx.articleVersion.updateMany({ where: { storyId, status: { not: 'reverted' } }, data: { status: 'reverted' } })
}

/**
 * The undo's swap: the current update reverted, the version before it current again, both fenced
 * on the statuses read before (a 409 that rolls the story write back when either moved on: another
 * undo or a pass landed meanwhile). Reverted first, so one version is current at every step. The
 * facts the undone update's pass demoted (`passId`) are back in use, as they were before it: left
 * demoted, a section of the restored version citing one would be rewritten again by the next pass
 * with nothing new found. Another pass's demotions stay.
 */
async function swapForUndo(tx: Prisma.TransactionClient, storyId: string, ids: { current: string; previous: string; passId: string | null }): Promise<void> {
  const undone = await tx.articleVersion.updateMany({ where: { id: ids.current, storyId, status: 'current' }, data: { status: 'reverted' } })
  const restored = await tx.articleVersion.updateMany({ where: { id: ids.previous, storyId, status: 'superseded' }, data: { status: 'current' } })
  if (undone.count === 0 || restored.count === 0) throw new ConflictError(STORY_CHANGED)
  if (ids.passId === null) return
  await tx.poolFact.updateMany({
    where: { storyId, status: 'demoted', droppedPassId: ids.passId },
    data: { status: 'unreviewed', droppedPassId: null, dropReason: null, contradictedBy: [] },
  })
}
