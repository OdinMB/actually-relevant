import { HumanMessage } from '@langchain/core/messages'
import type { ChatOpenAI } from '@langchain/openai'
import type { z } from 'zod'
import prisma from '../lib/prisma.js'
import { EmotionTag, Prisma, StoryStatus } from '@prisma/client'
import { config } from '../config.js'
import { Semaphore } from '../lib/semaphore.js'
import { splitIntoGroups } from '../lib/utils.js'
import { createLogger } from '../lib/logger.js'
import { taskRegistry } from '../lib/taskRegistry.js'
import { getSmallLLM, getMediumLLM, getLLMByTier, rateLimitDelay } from './llm.js'
import { buildPreassessPrompt, buildReclassifyPrompt, buildEmotionTagPrompt, buildAssessPrompt, buildSelectPrompt } from '../prompts/index.js'
import type { StoryForPreassess, IssueForPreassess } from '../prompts/index.js'
import { preAssessResultSchema, reclassifyResultSchema, assessResultSchema, selectResultSchema } from '../schemas/llm.js'
import type { Guidelines } from '../prompts/shared.js'
import { detectAndCluster } from './dedup.js'
import { generateEmbeddingForContent } from './embedding.js'
import { NotFoundError } from '../utils/errors.js'
import {
  analysisFrom, partition, recordAnalysis, transition,
  type Actor, type AnalysisOutcome, type AnalysisRow, type MoveResult,
} from './storyLifecycle.js'

const log = createLogger('analysis')

export type ProgressCallback = (
  event: { type: 'completed'; count: number } | { type: 'failed'; count: number; error: string }
) => void

function getGuidelines(issue: { promptFactors: string; promptAntifactors: string; promptRatings: string }): Guidelines {
  return {
    factors: issue.promptFactors,
    antifactors: issue.promptAntifactors,
    ratings: issue.promptRatings,
  }
}

// --- Shared batch classification helper ---

interface BatchClassificationOptions<T extends { articleId: string; issueSlug: string; emotionTag: string }> {
  storyIds: string[]
  llm: ChatOpenAI
  schema: z.ZodType<{ articles: T[] }>
  buildPrompt: (stories: StoryForPreassess[], issues: IssueForPreassess[]) => string
  buildUpdate: (item: T, issueId: string | null) => Prisma.StoryUncheckedUpdateManyInput
  /**
   * Write one batch's results. Default: plain field updates (reclassify, emotion tagging, which
   * never change status). Pre-assessment passes the lifecycle module's recordAnalysis.
   */
  persist?: (rows: AnalysisRow[]) => Promise<unknown>
  /** Whether to assign feed issue to stories not returned by the LLM. Default true (pre-assess behavior). */
  fallbackToFeedIssue?: boolean
  onProgress?: ProgressCallback
  batchSize: number
  concurrency: number
  label: string
}

const updateFields = (rows: AnalysisRow[]) =>
  prisma.$transaction(rows.map(r => prisma.story.update({ where: { id: r.id }, data: r.data })))

async function runBatchClassification<T extends { articleId: string; issueSlug: string; emotionTag: string }>(
  options: BatchClassificationOptions<T>,
): Promise<{ storyId: string; item: T }[]> {
  const {
    storyIds, llm, schema, buildPrompt, buildUpdate, persist = updateFields, fallbackToFeedIssue = true, onProgress, batchSize, concurrency, label,
  } = options

  const issues = await prisma.issue.findMany({
    select: { id: true, slug: true, name: true, description: true },
  })

  const slugToId = new Map(issues.map(i => [i.slug, i.id]))

  // Split IDs into batches — stories are loaded per-batch to avoid holding all sourceContent in memory
  const idBatches: string[][] = []
  for (let i = 0; i < storyIds.length; i += batchSize) {
    idBatches.push(storyIds.slice(i, i + batchSize))
  }

  log.info({ batchCount: idBatches.length, storyCount: storyIds.length }, `${label} batches prepared`)

  const structuredLlm = llm.withStructuredOutput(schema)
  const semaphore = new Semaphore(concurrency)
  const totalBatches = idBatches.length
  let batchesDone = 0

  const settled = await Promise.allSettled(
    idBatches.map((batchIds, batchIdx) =>
      semaphore.run(async () => {
        const batchLabel = `batch ${batchIdx + 1}/${totalBatches}`

        // Load stories for this batch only — avoids holding all sourceContent in memory
        const batch = await prisma.story.findMany({
          where: { id: { in: batchIds } },
          select: {
            id: true,
            sourceTitle: true,
            sourceContent: true,
            feed: { select: { issueId: true } },
          },
        })

        log.info({ batch: batchLabel, storyCount: batch.length }, 'processing batch')

        const prompt = buildPrompt(
          batch.map(s => ({ id: s.id, title: s.sourceTitle, content: s.sourceContent })),
          issues,
        )

        await rateLimitDelay()
        const response = await structuredLlm.invoke([new HumanMessage(prompt)])
        batchesDone++
        log.info({ progress: `${batchesDone}/${totalBatches}`, resultCount: response.articles.length, batch: batchLabel }, 'batch complete')

        const storyMap = new Map(batch.map(s => [s.id, s]))
        const batchResults: { storyId: string; item: T }[] = []
        const rows: AnalysisRow[] = []
        const fallbackRows: AnalysisRow[] = []
        for (const item of response.articles) {
          const story = storyMap.get(item.articleId)
          if (!story) {
            log.warn({ articleId: item.articleId }, 'LLM returned unknown articleId')
            continue
          }

          let issueId = slugToId.get(item.issueSlug)
          if (!issueId) {
            log.warn({ articleId: item.articleId, issueSlug: item.issueSlug }, 'invalid issue slug, falling back to feed issue')
            issueId = story.feed.issueId
          }

          rows.push({ id: story.id, data: buildUpdate(item, issueId) })

          batchResults.push({
            storyId: story.id,
            item,
          })
        }

        // Fallback: assign feed issue to stories not returned by LLM (opt-in)
        if (fallbackToFeedIssue) {
          for (const story of batch) {
            if (!batchResults.some(r => r.storyId === story.id)) {
              fallbackRows.push({ id: story.id, data: { issueId: story.feed.issueId } })
            }
          }
        }

        if (rows.length > 0) await persist(rows)
        if (fallbackRows.length > 0) await updateFields(fallbackRows)
        onProgress?.({ type: 'completed', count: batchResults.length })
        const missing = batch.length - batchResults.length
        if (missing > 0) {
          onProgress?.({ type: 'failed', count: missing, error: `Story not returned in ${label} results` })
        }
        return batchResults
      }),
    ),
  )

  const results: { storyId: string; item: T }[] = []
  let errors = 0
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(...result.value)
    } else {
      errors++
      log.error({ err: result.reason }, 'batch failed')
      onProgress?.({ type: 'failed', count: 1, error: result.reason instanceof Error ? result.reason.message : 'Batch failed' })
    }
  }
  if (errors > 0) log.warn({ errorCount: errors }, 'some batches failed')

  return results
}

// --- Pre-assessment ---

/**
 * Screen stories in batches. A `fetched` story (or, for an editor, a `rejected` one) moves to
 * `pre_analyzed`; a story further along keeps its status and gets the new screening fields; a
 * trashed story is left out before any model call (`storyLifecycle.ts`, recordAnalysis).
 */
export async function preAssessStories(
  storyIds: string[],
  onProgress?: ProgressCallback,
  actor: Actor = 'pipeline',
): Promise<{ storyId: string; rating: number; emotionTag: string }[]> {
  const { eligible, skipped } = await partition(storyIds, analysisFrom('preassess', actor))
  if (skipped.length > 0) {
    log.info({ skipped }, 'pre-assessment skipped stories whose status does not allow it')
    onProgress?.({ type: 'failed', count: skipped.length, error: 'Story status does not allow pre-assessment' })
  }
  if (eligible.length === 0) return []

  const results = await runBatchClassification({
    storyIds: eligible,
    llm: getMediumLLM(),
    schema: preAssessResultSchema,
    buildPrompt: buildPreassessPrompt,
    buildUpdate: (item, issueId) => ({
      issueId,
      relevancePre: item.rating,
      emotionTag: item.emotionTag as EmotionTag,
    }),
    persist: rows => recordAnalysis('preassess', actor, rows),
    onProgress,
    batchSize: config.preassess.batchSize,
    concurrency: config.concurrency.preassess,
    label: 'pre-assessment',
  })

  return results.map(r => ({
    storyId: r.storyId,
    rating: r.item.rating,
    emotionTag: r.item.emotionTag,
  }))
}

// --- Reclassification ---

export async function reclassifyStories(
  storyIds: string[],
  onProgress?: ProgressCallback,
): Promise<{ storyId: string; emotionTag: string }[]> {
  const results = await runBatchClassification({
    storyIds,
    llm: getSmallLLM(),
    schema: reclassifyResultSchema,
    buildPrompt: buildReclassifyPrompt,
    buildUpdate: (item, issueId) => ({
      issueId,
      emotionTag: item.emotionTag as EmotionTag,
    }),
    fallbackToFeedIssue: false,
    onProgress,
    batchSize: config.preassess.batchSize,
    concurrency: config.concurrency.reclassify,
    label: 'reclassification',
  })

  return results.map(r => ({
    storyId: r.storyId,
    emotionTag: r.item.emotionTag,
  }))
}

// --- Emotion-only tagging ---

export async function tagEmotionOnly(
  storyIds: string[],
  onProgress?: ProgressCallback,
): Promise<{ storyId: string; emotionTag: string }[]> {
  const results = await runBatchClassification({
    storyIds,
    llm: getSmallLLM(),
    schema: reclassifyResultSchema,
    buildPrompt: buildEmotionTagPrompt,
    buildUpdate: (item) => ({
      emotionTag: item.emotionTag as EmotionTag,
    }),
    fallbackToFeedIssue: false,
    onProgress,
    batchSize: config.preassess.batchSize,
    concurrency: config.concurrency.reclassify,
    label: 'emotion-tagging',
  })

  return results.map(r => ({
    storyId: r.storyId,
    emotionTag: r.item.emotionTag,
  }))
}

// --- Full assessment ---

/**
 * Fully assess one story. A story before `analyzed` (or, for an editor, a `rejected` one) moves to
 * `analyzed`; an `analyzed`, `selected` or `published` story keeps its status and gets the new
 * analysis and embedding; a trashed story is skipped without a model call, as is one trashed while
 * the call ran (`storyLifecycle.ts`, recordAnalysis).
 */
export async function assessStory(storyId: string, actor: Actor = 'pipeline'): Promise<AnalysisOutcome> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: { issue: true, feed: { include: { issue: true } } },
  })
  if (!story) throw new NotFoundError('Story not found')
  if (!analysisFrom('assess', actor).includes(story.status)) {
    log.info({ storyId, status: story.status, actor }, 'assessment skipped: status does not allow it')
    return 'skipped'
  }

  log.info({ storyId, title: story.sourceTitle?.slice(0, 80) }, 'assessing story')

  const guidelines = getGuidelines(story.issue ?? story.feed.issue)
  const publisher = story.feed.title
  const prompt = buildAssessPrompt(story.sourceTitle, story.sourceContent, publisher, story.sourceUrl, guidelines)

  await rateLimitDelay()
  const llm = getLLMByTier(config.assess.modelTier)
  const structuredLlm = llm.withStructuredOutput(assessResultSchema)
  const parsed = await structuredLlm.invoke([new HumanMessage(prompt)])

  log.info({ storyId, rating: parsed.conservativeRating, title: parsed.relevanceTitle?.slice(0, 60) }, 'assessment complete')

  const analysisData = {
    titleLabel: parsed.titleLabel || null,
    title: parsed.relevanceTitle || null,
    summary: parsed.summary || null,
    quote: parsed.quote || null,
    quoteAttribution: parsed.quoteAttribution || null,
    marketingBlurb: parsed.marketingBlurb || null,
    relevanceSummary: parsed.relevanceSummary || null,
    relevanceReasons: parsed.factors.join('\n'),
    antifactors: parsed.limitingFactors.join('\n'),
    relevanceCalculation: parsed.relevanceCalculation.join('\n'),
    relevance: parsed.conservativeRating,
  }

  // Generate embedding from analysis results BEFORE saving — throws on failure
  const embeddingData = await generateEmbeddingForContent({
    title: analysisData.title,
    titleLabel: analysisData.titleLabel,
    summary: analysisData.summary,
    embeddingContentHash: null, // force generation
  })

  // Save analysis + embedding atomically, unless the status changed during the call
  const outcomes = await recordAnalysis('assess', actor, [{ id: storyId, data: analysisData, embedding: embeddingData }])
  const outcome = outcomes.get(storyId) ?? 'skipped'
  if (outcome === 'skipped') return outcome

  // Dedup runs after the transaction — embedding is guaranteed to exist
  if (config.dedup.enabled) {
    detectAndCluster(storyId)
      .then(result => {
        if (result.clusterId) {
          log.info({ storyId, ...result }, 'post-assessment dedup result')
        }
      })
      .catch(err => {
        log.error({ err, storyId }, 'post-assessment dedup failed')
      })
  }
  return outcome
}

/** Orchestrate concurrent assessment of multiple stories. */
export async function assessStories(
  storyIds: string[],
  onProgress?: ProgressCallback,
  actor: Actor = 'pipeline',
): Promise<{ completed: number; errors: number }> {
  const semaphore = new Semaphore(config.concurrency.assess)
  let completed = 0
  let errors = 0

  const settled = await Promise.allSettled(
    storyIds.map(id =>
      semaphore.run(async () => {
        await assessStory(id, actor)
        completed++
        onProgress?.({ type: 'completed', count: 1 })
      }),
    ),
  )

  for (const result of settled) {
    if (result.status === 'rejected') {
      errors++
      const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error'
      log.error({ storyId: storyIds[settled.indexOf(result)], err: result.reason }, 'story assessment failed')
      onProgress?.({ type: 'failed', count: 1, error: msg })
    }
  }

  return { completed, errors }
}

export interface SelectionResult {
  /** Ids that moved to `selected` */
  selected: string[]
  /** Ids that moved to `rejected` (as duplicates or not picked) */
  rejected: string[]
  /** Ids left alone: not `analyzed` when read, or no longer when written */
  skipped: string[]
}

/** In `ids` order, the ids a move reported as moved. */
const inOrder = (ids: string[], result: MoveResult) => {
  const moved = new Set(result.moved)
  return ids.filter(id => moved.has(id))
}

export async function selectStories(storyIds: string[]): Promise<SelectionResult> {
  // Only `analyzed` stories enter the pool; any other id is skipped, never selected or rejected
  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds }, status: StoryStatus.analyzed },
    include: { cluster: { select: { primaryStoryId: true } } },
  })
  const poolIds = new Set(stories.map(s => s.id))
  const skipped = [...new Set(storyIds)].filter(id => !poolIds.has(id))

  if (stories.length === 0) return { selected: [], rejected: [], skipped }

  // Dedup safety net: keep only primary (or unclustered) stories for LLM selection
  const dedupFiltered = stories.filter(s => {
    if (!s.cluster) return true // no cluster — keep
    return s.cluster.primaryStoryId === s.id // only primary
  })
  const nonPrimaryIds = stories
    .filter(s => s.cluster && s.cluster.primaryStoryId !== s.id)
    .map(s => s.id)

  // Safety net: re-reject non-primary stories that may have been manually un-rejected
  const dedup = await transition(nonPrimaryIds, { to: 'rejected', reason: 'duplicate' }, 'pipeline')
  if (nonPrimaryIds.length > 0) {
    log.info({ filtered: nonPrimaryIds.length }, 'filtered non-primary cluster members from selection')
  }
  const dedupRejectedIds = inOrder(nonPrimaryIds, dedup)
  skipped.push(...dedup.skipped.map(s => s.id))

  if (dedupFiltered.length === 0) return { selected: [], rejected: dedupRejectedIds, skipped }

  log.info({ storyCount: dedupFiltered.length }, 'selecting from stories')

  const toSelect = Math.ceil(dedupFiltered.length * config.selection.ratio)
  const prompt = buildSelectPrompt(
    dedupFiltered.map(s => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      relevanceReasons: s.relevanceReasons,
      antifactors: s.antifactors,
      relevanceCalculation: s.relevanceCalculation,
      emotionTag: s.emotionTag,
      sourceDatePublished: s.sourceDatePublished?.toISOString() ?? null,
    })),
    toSelect,
    new Date().toISOString(),
  )

  await rateLimitDelay()
  const llm = getLLMByTier(config.selection.modelTier)
  const structuredLlm = llm.withStructuredOutput(selectResultSchema)
  const response = await structuredLlm.invoke([new HumanMessage(prompt)])

  log.info({ selectedCount: response.selectedIds.length }, 'LLM selection response received')

  const selectedSet = new Set(response.selectedIds)
  const picked = dedupFiltered.filter(s => selectedSet.has(s.id)).map(s => s.id)
  const notPicked = dedupFiltered.filter(s => !selectedSet.has(s.id)).map(s => s.id)

  // Conditional moves: a story trashed or rejected by an editor during the call stays as it is
  const selection = await transition(picked, { to: 'selected' }, 'pipeline')
  const rejection = await transition(notPicked, { to: 'rejected', reason: 'selection' }, 'pipeline')
  skipped.push(...selection.skipped.map(s => s.id), ...rejection.skipped.map(s => s.id))

  return {
    selected: inOrder(picked, selection),
    rejected: [...dedupRejectedIds, ...inOrder(notPicked, rejection)],
    skipped,
  }
}

/** Split stories into groups and run concurrent selection across groups. */
export async function selectStoriesInGroups(
  storyIds: string[],
  onProgress?: ProgressCallback,
): Promise<{ selected: number; rejected: number; skipped: number; errors: number }> {
  const groups = splitIntoGroups(storyIds, config.selection.maxGroupSize)
  const semaphore = new Semaphore(config.concurrency.select)

  log.info({ storyCount: storyIds.length, groupCount: groups.length }, 'selecting stories in groups')

  let totalSelected = 0
  let totalRejected = 0
  let totalSkipped = 0
  let errors = 0

  const settled = await Promise.allSettled(
    groups.map((group, i) =>
      semaphore.run(async () => {
        log.info({ group: i + 1, totalGroups: groups.length, storyCount: group.length }, 'processing group')
        const result = await selectStories(group)
        // A skipped story was handled: its status no longer allowed selection
        const processed = result.selected.length + result.rejected.length + result.skipped.length
        onProgress?.({ type: 'completed', count: processed })
        const unprocessed = group.length - processed
        if (unprocessed > 0) {
          onProgress?.({ type: 'failed', count: unprocessed, error: 'Story not included in selection result' })
        }
        return result
      }),
    ),
  )

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      totalSelected += result.value.selected.length
      totalRejected += result.value.rejected.length
      totalSkipped += result.value.skipped.length
    } else {
      errors++
      const msg = result.reason instanceof Error ? result.reason.message : 'Unknown error'
      log.error({ err: result.reason }, 'group selection failed')
      const groupIndex = settled.indexOf(result)
      const failedCount = groups[groupIndex]?.length ?? 0
      onProgress?.({ type: 'failed', count: failedCount, error: msg })
    }
  }

  return { selected: totalSelected, rejected: totalRejected, skipped: totalSkipped, errors }
}

// --- Bulk wrappers with task progress tracking ---

function taskProgressCallback(taskId: string): ProgressCallback {
  return (event) => {
    if (event.type === 'completed') {
      for (let i = 0; i < event.count; i++) taskRegistry.increment(taskId, 'completed')
    } else {
      for (let i = 0; i < event.count; i++) taskRegistry.increment(taskId, 'failed', event.error)
    }
  }
}

export async function bulkPreAssess(storyIds: string[], taskId: string): Promise<void> {
  try {
    await preAssessStories(storyIds, taskProgressCallback(taskId), 'editor')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    log.error({ err, taskId }, 'bulk pre-assess failed')
    for (const _id of storyIds) {
      taskRegistry.increment(taskId, 'failed', msg)
    }
  } finally {
    taskRegistry.complete(taskId)
  }
}

export async function bulkReclassify(storyIds: string[], taskId: string): Promise<void> {
  try {
    await reclassifyStories(storyIds, taskProgressCallback(taskId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    log.error({ err, taskId }, 'bulk reclassify failed')
    for (const _id of storyIds) {
      taskRegistry.increment(taskId, 'failed', msg)
    }
  } finally {
    taskRegistry.complete(taskId)
  }
}

export async function bulkTagEmotions(storyIds: string[], taskId: string): Promise<void> {
  try {
    await tagEmotionOnly(storyIds, taskProgressCallback(taskId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    log.error({ err, taskId }, 'bulk emotion tagging failed')
    for (const _id of storyIds) {
      taskRegistry.increment(taskId, 'failed', msg)
    }
  } finally {
    taskRegistry.complete(taskId)
  }
}

export async function bulkAssess(storyIds: string[], taskId: string): Promise<void> {
  try {
    await assessStories(storyIds, taskProgressCallback(taskId), 'editor')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    log.error({ err, taskId }, 'bulk assess failed')
    for (const _id of storyIds) {
      taskRegistry.increment(taskId, 'failed', msg)
    }
  } finally {
    taskRegistry.complete(taskId)
  }
}

export async function bulkSelect(storyIds: string[], taskId: string): Promise<void> {
  try {
    await selectStoriesInGroups(storyIds, taskProgressCallback(taskId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    log.error({ err, taskId }, 'bulk select failed')
    for (const _id of storyIds) {
      taskRegistry.increment(taskId, 'failed', msg)
    }
  } finally {
    taskRegistry.complete(taskId)
  }
}
