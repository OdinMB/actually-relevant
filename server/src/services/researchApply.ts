/**
 * Turning a finished research run into the story's state, and back (`.context/story-research.md`,
 * "Applying a run"). An apply writes the run's researched texts into the story's own columns
 * (`researchSwap.ts`), keeps what they held in `pre_research`, written once so that a revert always
 * returns to the single-source analysis, and stores the cited version readers see in `research`. A
 * revert writes the snapshot back and clears both. Each write goes through
 * `recordAnalysis('research', …)` with a fresh embedding, so a status is never moved here and an
 * editor's move made meanwhile wins. Refusals are ServiceErrors.
 */
import { Prisma, type StoryStatus } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import { generateEmbeddingForContent } from './embedding.js'
import { buildResearchedStory, researchedStorySchema, type ResearchedStory } from './researchedStory.js'
import type { ResearchSource } from './researchPipeline.js'
import type { StoredResearch } from './researchRuns.js'
import { appliedDraftSchema, researchedValues, restoredValues, snapshotOf, SWAPPED_SELECT, type SwappedValues } from './researchSwap.js'
import { fetchSourceFaviconsInBackground, type SourceIconHint } from './sourceFavicons.js'
import { analysisFrom, recordAnalysis, type Actor } from './storyLifecycle.js'

const log = createLogger('research-apply')

/** `skipped`: the pipeline's story changed status during its run (an editor's apply answers 409 instead). */
export type ApplyOutcome = 'applied' | 'skipped'

const STATUS_CHANGED = "The story's status changed while this was written; reload it and try again"

async function loadStory(storyId: string) {
  const story = await prisma.story.findUnique({ where: { id: storyId }, select: { status: true, preResearch: true, ...SWAPPED_SELECT } })
  if (!story) throw new NotFoundError('Story not found')
  return story
}

/** Why a story at `status` takes no research write (the stage's statuses: analyzed, selected, published, rejected); null when it takes one. */
function statusRefusal(status: StoryStatus, action: 'take a researched version' | 'be reverted'): string | null {
  if (analysisFrom('research', 'editor').includes(status)) return null
  if (status === 'trashed') return `A trashed story cannot ${action}: restore it first`
  return `Only analyzed, selected, published or rejected stories can ${action}; this one is ${status}`
}

/** The run's draft, sources and earlier stories, or why this story cannot take its researched version. */
async function applicableRun(storyId: string, runId: string) {
  const run = await prisma.storyResearchRun.findUnique({ where: { id: runId }, select: { storyId: true, status: true, result: true } })
  if (!run) throw new NotFoundError('Research run not found')
  if (run.storyId !== storyId) throw new ConflictError('This run researched another story')
  if (run.status !== 'completed') throw new ConflictError(`Only a completed run can be applied; this one is ${run.status}`)
  const result = run.result as unknown as StoredResearch | null
  if (!result?.draft) throw new ConflictError('This run wrote no draft to apply')
  if (result.verdict.kind === 'fallback') throw new ConflictError("This run fell back to today's format: it has no researched version to apply")
  const draft = appliedDraftSchema.safeParse(result.draft)
  if (!draft.success) throw new ConflictError('This run is from an older format and cannot be applied; research the story again')
  return { draft: draft.data, sources: result.sources, earlier: result.earlier }
}

/** Each cited outside source's host, with the icon address the search gave for it (tried first). */
function iconHints(research: ResearchedStory, sources: ResearchSource[]): SourceIconHint[] {
  const favicons = new Map(sources.map(s => [s.id, s.favicon]))
  return research.sources.flatMap(s => (s.host ? [{ host: s.host, favicon: favicons.get(s.id) ?? null }] : []))
}

/** The swapped columns and both versions in one lifecycle write, with the embedding of the text written; false when the status no longer allows it. */
async function write(
  storyId: string,
  actor: Actor,
  status: StoryStatus,
  values: SwappedValues,
  versions: Pick<Prisma.StoryUncheckedUpdateManyInput, 'research' | 'preResearch'>,
): Promise<boolean> {
  // A slow external call, before the transaction; it throws on failure, and nothing is written
  const embedding = await generateEmbeddingForContent({
    title: values.title,
    titleLabel: values.titleLabel,
    summary: values.summary,
    embeddingContentHash: null,
  })
  const outcomes = await recordAnalysis('research', actor, [{ id: storyId, data: { ...values, ...versions }, embedding }], new Map([[storyId, status]]))
  return outcomes.get(storyId) !== 'skipped'
}

const asJson = (value: Prisma.JsonValue | object) => value as unknown as Prisma.InputJsonValue

/**
 * Put a run's researched version on the story. An editor's apply is written against the status read
 * now, the pipeline's against `expectedStatus`, the one it read before its run, so a story an editor
 * published or rejected meanwhile is skipped. 409 first while research is switched off (no
 * `TAVILY_API_KEY`): the switch stops new research going live, though a revert still works. Then 404
 * for an unknown story or run; 409 for a run of another story, one not completed, without a draft,
 * fallen back or of an older format, and for a status outside analyzed, selected, published and
 * rejected. Then the outlets' favicons are fetched in the background; the page shows each outlet's
 * initial until its icon is stored.
 */
export async function applyResearchRun(storyId: string, runId: string, actor: Actor = 'editor', expectedStatus?: StoryStatus): Promise<ApplyOutcome> {
  if (!config.research.tavilyApiKey)
    throw new ConflictError('Research is switched off: TAVILY_API_KEY is not set, so no run can be applied (reverting still works)')
  const story = await loadStory(storyId)
  const run = await applicableRun(storyId, runId)
  const status = expectedStatus ?? story.status
  const refusal = statusRefusal(status, 'take a researched version')
  if (refusal) {
    if (actor === 'editor') throw new ConflictError(refusal)
    return 'skipped'
  }

  const research = buildResearchedStory(run)
  if (!researchedStorySchema.safeParse(research).success) throw new ConflictError("This run's sources do not make a version readers can be given")
  // Written once: re-applying keeps the snapshot of the single-source analysis
  const preResearch = story.preResearch ?? snapshotOf(story)

  const written = await write(storyId, actor, status, researchedValues(run.draft), { research: asJson(research), preResearch: asJson(preResearch) })
  if (!written) {
    if (actor === 'editor') throw new ConflictError(STATUS_CHANGED)
    log.info({ storyId, runId, actor }, 'research not applied: the story changed status during the run')
    return 'skipped'
  }
  log.info({ storyId, runId, actor }, 'research applied')
  void fetchSourceFaviconsInBackground(iconHints(research, run.sources))
  return 'applied'
}

/**
 * Give the story its single-source analysis back: the snapshot's values, both versions cleared, an
 * embedding of the restored text, written against the status read now. 404 for an unknown story;
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

  if (!(await write(storyId, 'editor', story.status, restored, { research: Prisma.DbNull, preResearch: Prisma.DbNull })))
    throw new ConflictError(STATUS_CHANGED)
  log.info({ storyId }, 'research reverted')
}
