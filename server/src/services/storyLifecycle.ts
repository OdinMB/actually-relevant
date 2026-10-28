/**
 * How a story changes status, and what each change implies for its cluster (ADR-0045,
 * `.context/story-pipeline.md` "Transition Rules"). This module is the only code that writes
 * `stories.status` and `stories.rejection_reason` (held by `test/statusWriters.test.ts`):
 *
 * - the transition table: which statuses each move may start from, per actor;
 * - conditional moves: one `UPDATE ... WHERE status IN (allowed)` per chunk of a move, reporting
 *   which ids moved and which were skipped, so a story trashed while a model call ran stays trashed;
 * - publishing: embeddings outside the transaction, then slugs, dates and the flip under the slug
 *   lock;
 * - cluster primaries: election, auto-rejection of duplicates, restoring them; and the cluster
 *   edits (dissolve, remove member, merge) as single transactions.
 *
 * Lock order in every transaction that touches status and clusters: the slug advisory lock
 * (publish only), then the affected `story_clusters` rows ordered by id, then the story rows
 * ordered by id. A move reads its stories' cluster ids before it can lock them; when a story
 * joined another cluster in between, the move re-checks after its row locks and runs the whole
 * transaction again (at most three attempts) rather than lock that cluster out of order
 * (`lockForMove`).
 */
import { Prisma, RejectionReason, StoryStatus } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { saveEmbeddingTx } from '../lib/vectors.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'
import { ensureEmbeddings } from './embedding.js'
import { forgetRelatedStories } from './relatedStories.js'
import { generateUniqueSlugs, saveSlugs, withSlugLock } from './storySlugs.js'

const log = createLogger('story-lifecycle')

type Tx = Prisma.TransactionClient

/** `pipeline`: jobs and the bulk analysis and selection actions. `editor`: explicit admin actions. */
export type Actor = 'pipeline' | 'editor'

export type Move = { to: typeof StoryStatus.rejected; reason: RejectionReason } | { to: Exclude<StoryStatus, typeof StoryStatus.rejected> }

/** A story a move left alone, with the status that kept it there (null: no such story). */
export interface Skipped {
  id: string
  status: StoryStatus | null
}

export interface MoveResult {
  moved: string[]
  skipped: Skipped[]
}

// ──── Transition table ──────────────────────────────────────────────────

const { fetched, pre_analyzed, analyzed, selected, published, rejected, trashed } = StoryStatus
const ALL_STATUSES = Object.values(StoryStatus)

/** Where an auto-rejection of a non-primary starts from; published members are kept. */
const DUPLICATE_FROM: StoryStatus[] = [fetched, pre_analyzed, analyzed, selected]

const PIPELINE_REJECTION_FROM: Partial<Record<RejectionReason, StoryStatus[]>> = {
  assess_threshold: [pre_analyzed],
  select_threshold: [analyzed],
  selection: [analyzed],
  duplicate: DUPLICATE_FROM,
}

const PIPELINE_FROM: Partial<Record<StoryStatus, StoryStatus[]>> = {
  selected: [analyzed],
  // Plus: unclustered, or the primary of its cluster (publishChunk)
  published: [selected],
}

/** The statuses `move` may start from for `actor`. An editor may move a story from anywhere else. */
export function allowedFrom(move: Move, actor: Actor): StoryStatus[] {
  if (actor === 'editor') return ALL_STATUSES.filter(s => s !== move.to)
  const from = move.to === rejected ? PIPELINE_REJECTION_FROM[move.reason] : PIPELINE_FROM[move.to]
  if (!from) {
    throw new Error(`the pipeline has no move to ${move.to}${move.to === rejected ? ` (${move.reason})` : ''}`)
  }
  return from
}

/** The editor move a status picked in the admin (status endpoints, the edit form) stands for. */
export function editorMoveTo(status: StoryStatus): Move {
  return status === rejected ? { to: rejected, reason: RejectionReason.editor } : { to: status }
}

/** The status and reason a newly crawled story starts with: a paywall-locked one is rejected (ADR-0031). */
export function initialStatus(accessTier: string | null | undefined): { status: StoryStatus; rejectionReason: RejectionReason | null } {
  return accessTier === 'locked' ? { status: rejected, rejectionReason: RejectionReason.paywall } : { status: fetched, rejectionReason: null }
}

const moveData = (move: Move) => ({
  status: move.to,
  rejectionReason: move.to === rejected ? move.reason : null,
})

const describeMove = (move: Move) => (move.to === rejected ? `rejected/${move.reason}` : move.to)

// ──── Analysis results ──────────────────────────────────────────────────

export type AnalysisStage = 'preassess' | 'assess'
export type AnalysisOutcome = 'advanced' | 'refreshed' | 'skipped'

/**
 * Where an analysis result may land. `advance` moves the story to the stage's status; `refresh`
 * writes the fields and keeps the status, so re-assessing never moves a story backward (a
 * published story stays on the site). Only an editor's analysis re-queues a `rejected` story;
 * `trashed` is never written.
 */
const ANALYSIS: Record<AnalysisStage, { to: StoryStatus; advance: Record<Actor, StoryStatus[]>; refresh: StoryStatus[] }> = {
  preassess: {
    to: pre_analyzed,
    advance: { pipeline: [fetched], editor: [fetched, rejected] },
    refresh: [pre_analyzed, analyzed, selected, published],
  },
  assess: {
    to: analyzed,
    advance: { pipeline: [fetched, pre_analyzed], editor: [fetched, pre_analyzed, rejected] },
    refresh: [analyzed, selected, published],
  },
}

export interface AnalysisRow {
  id: string
  data: Prisma.StoryUncheckedUpdateManyInput
  embedding?: { embedding: number[]; hash: string } | null
}

/**
 * Write analysis results in one transaction, each row conditional on `expected`: the status the
 * caller read before its model call. A story whose status changed meanwhile (an editor trashed or
 * rejected it during the call) is skipped and gets neither the fields nor the embedding, so the
 * editor's move is never reverted.
 */
export async function recordAnalysis(
  stage: AnalysisStage,
  actor: Actor,
  rows: AnalysisRow[],
  expected: ReadonlyMap<string, StoryStatus>,
): Promise<Map<string, AnalysisOutcome>> {
  const outcomes = new Map<string, AnalysisOutcome>()
  if (rows.length === 0) return outcomes
  const { to, advance, refresh } = ANALYSIS[stage]

  // lockForMove throws before any outcome is set, so a retried attempt starts clean
  await retryOnClusterChange(() =>
    prisma.$transaction(
      async tx => {
        await lockForMove(
          tx,
          rows.map(r => r.id),
        )
        for (const row of rows) {
          const status = expected.get(row.id)
          const outcome: AnalysisOutcome = status && advance[actor].includes(status) ? 'advanced' : status && refresh.includes(status) ? 'refreshed' : 'skipped'
          outcomes.set(row.id, outcome)
          if (outcome === 'skipped') continue
          const { count } = await tx.story.updateMany({
            where: { id: row.id, status },
            data: outcome === 'advanced' ? { ...row.data, status: to, rejectionReason: null } : row.data,
          })
          if (count === 0) {
            outcomes.set(row.id, 'skipped')
            continue
          }
          if (row.embedding) await saveEmbeddingTx(tx, row.id, row.embedding.embedding, row.embedding.hash)
        }
      },
      { timeout: config.database.transactionTimeoutMs },
    ),
  )

  // A refreshed published story has new content: its cached related list is stale
  forgetRelatedStories(rows.filter(r => outcomes.get(r.id) === 'refreshed').map(r => r.id))
  const skipped = [...outcomes].filter(([, o]) => o === 'skipped').map(([id]) => id)
  if (skipped.length > 0) log.info({ stage, actor, skipped }, 'analysis results skipped: status no longer allows them')
  return outcomes
}

/** The statuses an analysis stage may write to for `actor` (advance or refresh). */
export function analysisFrom(stage: AnalysisStage, actor: Actor): StoryStatus[] {
  return [...ANALYSIS[stage].advance[actor], ...ANALYSIS[stage].refresh]
}

// ──── Read-only partition ───────────────────────────────────────────────

/**
 * Split ids into those `from` admits now and the rest (read-only: for bulk routes before they
 * queue a task, and for analysis before its model call). `statuses` holds the eligible ids'
 * statuses as read, for `recordAnalysis`.
 */
export async function partition(ids: string[], from: StoryStatus[]): Promise<{ eligible: string[]; skipped: Skipped[]; statuses: Map<string, StoryStatus> }> {
  const current = await currentStatuses(prisma, ids)
  const eligible: string[] = []
  const skipped: Skipped[] = []
  const statuses = new Map<string, StoryStatus>()
  for (const id of new Set(ids)) {
    const status = current.get(id) ?? null
    if (status && from.includes(status)) {
      eligible.push(id)
      statuses.set(id, status)
    } else skipped.push({ id, status })
  }
  return { eligible, skipped, statuses }
}

// ──── Moves ─────────────────────────────────────────────────────────────

/**
 * Move stories by the transition table. Ids whose current status the move does not start from
 * are skipped and reported, never forced. Editor moves re-elect the cluster primary when they
 * move a cluster's primary or a published member; a publish re-elects in pipeline mode.
 */
export async function transition(ids: string[], move: Move, actor: Actor): Promise<MoveResult> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return { moved: [], skipped: [] }
  const from = allowedFrom(move, actor)

  const result = move.to === published ? await publishIds(unique, from, actor) : await moveIds(unique, move, from, actor)

  if (actor === 'editor' && move.to !== published) forgetRelatedStories(result.moved)
  log.info(
    {
      move: describeMove(move),
      actor,
      moved: result.moved.length,
      ...(result.skipped.length > 0 ? { skipped: result.skipped } : {}),
    },
    'story status move',
  )
  return result
}

/**
 * Move in bounded chunks (`config.database.moveChunkSize`), each its own transaction, so a large
 * backlog never holds one transaction past the timeout. A later chunk's failure leaves earlier
 * chunks moved; the moves are conditional, so a re-run picks up only what is left.
 */
async function moveIds(ids: string[], move: Move, from: StoryStatus[], actor: Actor): Promise<MoveResult> {
  const result: MoveResult = { moved: [], skipped: [] }
  for (let i = 0; i < ids.length; i += config.database.moveChunkSize) {
    const chunk = ids.slice(i, i + config.database.moveChunkSize)
    const part = await retryOnClusterChange(() =>
      inTransaction(tx => (actor === 'editor' ? editorMove(tx, chunk, move, from) : pipelineMove(tx, chunk, move, from))),
    )
    result.moved.push(...part.moved)
    result.skipped.push(...part.skipped)
  }
  return result
}

async function pipelineMove(tx: Tx, ids: string[], move: Move, from: StoryStatus[]): Promise<MoveResult> {
  const before = await lockForMove(tx, ids)
  const moved = await moveWhere(tx, { id: { in: ids }, status: { in: from } }, move)
  return { moved, skipped: skippedOf(ids, moved, before) }
}

async function editorMove(tx: Tx, ids: string[], move: Move, from: StoryStatus[]): Promise<MoveResult> {
  const before = await lockForMove(tx, ids)
  // An editor's reject also overrides another reason (a duplicate stays rejected for good)
  const fromRejected: Prisma.StoryWhereInput[] =
    move.to === rejected ? [{ status: rejected, OR: [{ rejectionReason: null }, { rejectionReason: { not: move.reason } }] }] : []
  const moved = await moveWhere(tx, { id: { in: ids }, OR: [{ status: { in: from } }, ...fromRejected] }, move)

  // Moving a cluster's face (its primary, or a published member) changes who should lead it
  const clusters = new Set<string>()
  for (const id of moved) {
    const b = before.get(id)
    if (b?.clusterId && (b.isPrimary || b.status === published)) clusters.add(b.clusterId)
  }
  for (const clusterId of [...clusters].sort()) await reelectPrimary(clusterId, 'editor-story', tx)
  return { moved, skipped: skippedOf(ids, moved, before) }
}

async function moveWhere(tx: Tx, where: Prisma.StoryWhereInput, move: Move): Promise<string[]> {
  const rows = await tx.story.updateManyAndReturn({ where, data: moveData(move), select: { id: true } })
  return rows.map(r => r.id)
}

function skippedOf(ids: string[], moved: string[], before: Map<string, LockedStory>): Skipped[] {
  const movedSet = new Set(moved)
  return ids.filter(id => !movedSet.has(id)).map(id => ({ id, status: before.get(id)?.status ?? null }))
}

// ──── Publishing ────────────────────────────────────────────────────────

/**
 * Publish in bounded chunks (`config.publish.chunkSize`) so the embedding fetch and the
 * slug-locked transaction stay small however large the `selected` backlog is (Render's memory
 * limit, the transaction timeout). Each chunk commits on its own: a later chunk's failure leaves
 * earlier ones published, and the next run resumes from what is still `selected`.
 */
async function publishIds(ids: string[], from: StoryStatus[], actor: Actor): Promise<MoveResult> {
  const result: MoveResult = { moved: [], skipped: [] }
  for (let i = 0; i < ids.length; i += config.publish.chunkSize) {
    const chunk = ids.slice(i, i + config.publish.chunkSize)
    await ensureEmbeddingsBeforePublish(chunk, from)
    const part = await retryOnClusterChange(() => withSlugLock(tx => publishChunk(tx, chunk, from, actor)))
    result.moved.push(...part.moved)
    result.skipped.push(...part.skipped)
  }
  return result
}

/** Slow external calls, so outside any transaction; a failure publishes without the embedding. */
async function ensureEmbeddingsBeforePublish(chunk: string[], from: StoryStatus[]): Promise<void> {
  const eligible = await prisma.story.findMany({ where: { id: { in: chunk }, status: { in: from } }, select: { id: true } })
  if (eligible.length === 0) return
  try {
    await ensureEmbeddings(eligible.map(s => s.id))
  } catch (err) {
    log.warn({ err, storyCount: eligible.length }, 'failed to ensure embeddings on publish, proceeding without')
  }
}

async function publishChunk(tx: Tx, chunk: string[], from: StoryStatus[], actor: Actor): Promise<MoveResult> {
  const before = await lockForMove(tx, chunk)

  const flipped = await tx.story.updateManyAndReturn({
    where: {
      id: { in: chunk },
      status: { in: from },
      // The job publishes one story per cluster: its primary (decision 7)
      ...(actor === 'pipeline' ? { OR: [{ clusterId: null }, { primaryOfCluster: { isNot: null } }] } : {}),
    },
    data: { status: published, rejectionReason: null },
    select: { id: true, slug: true, title: true, sourceTitle: true, clusterId: true },
  })
  const moved = flipped.map(s => s.id)

  // Slugs and dates only for rows that actually moved; a slug or date already set is kept
  await saveSlugs(
    tx,
    await generateUniqueSlugs(
      flipped.filter(s => !s.slug),
      tx,
    ),
  )
  if (moved.length > 0) {
    await tx.story.updateMany({ where: { id: { in: moved }, datePublished: null }, data: { datePublished: new Date() } })
  }

  // Every cluster the chunk touches, not only the moved stories': a `selected` non-primary the
  // job left alone is rejected as a duplicate here rather than waiting in `selected` for good
  const clusterIds = [...before.values(), ...flipped].map(s => s.clusterId).filter((c): c is string => c !== null)
  for (const clusterId of [...new Set(clusterIds)].sort()) await reelectPrimary(clusterId, 'pipeline', tx)

  // Skipped ids report their status after the election, which may have just rejected them
  const movedSet = new Set(moved)
  const skippedIds = chunk.filter(id => !movedSet.has(id))
  const after = await currentStatuses(tx, skippedIds)
  return { moved, skipped: skippedIds.map(id => ({ id, status: after.get(id) ?? null })) }
}

// ──── Cluster primaries ─────────────────────────────────────────────────

/**
 * - `pipeline`: dedup, publishing, repair after deletion. Auto-rejection keeps published members;
 *   nothing is moved out of `rejected`.
 * - `editor-story`: an editor's status move of a primary or published member. As pipeline, but an
 *   elected duplicate is restored.
 * - `editor-cluster`: an editor's cluster edit. Published non-primaries are rejected too; the
 *   chosen or elected primary is restored if it was a duplicate.
 */
export type ElectionMode = 'pipeline' | 'editor-story' | 'editor-cluster'

interface Member {
  id: string
  status: StoryStatus
  rejectionReason: RejectionReason | null
  relevance: number | null
  dateCrawled: Date
  datePublished: Date | null
}

const isDuplicate = (m: Pick<Member, 'status' | 'rejectionReason'>) => m.status === rejected && m.rejectionReason === RejectionReason.duplicate

/** Never a trashed member, nor one rejected for any reason but being a duplicate. */
const electable = (m: Member) => m.status !== trashed && (m.status !== rejected || isDuplicate(m))

/** Duplicates last; then published first (earliest), highest relevance, first crawled. */
function byElectionRank(a: Member, b: Member): number {
  if (isDuplicate(a) !== isDuplicate(b)) return isDuplicate(a) ? 1 : -1
  const aPub = a.status === published
  const bPub = b.status === published
  if (aPub !== bPub) return aPub ? -1 : 1
  if (aPub && bPub) return (a.datePublished?.getTime() ?? 0) - (b.datePublished?.getTime() ?? 0)
  if ((b.relevance ?? 0) !== (a.relevance ?? 0)) return (b.relevance ?? 0) - (a.relevance ?? 0)
  return a.dateCrawled.getTime() - b.dateCrawled.getTime()
}

export interface ElectionResult {
  primaryId: string | null
  rejected: string[]
  restored: string[]
}

/**
 * Elect the cluster's primary (or take `chosenPrimaryId`), then auto-reject the other members as
 * duplicates. Run inside a transaction that holds the cluster's row lock. If no member qualifies,
 * the primary pointer stays as it is (or is cleared when it names a story no longer a member).
 */
export async function reelectPrimary(clusterId: string, mode: ElectionMode, tx: Tx, chosenPrimaryId?: string): Promise<ElectionResult> {
  // The members' rows in id order before any write (the caller holds the cluster's lock)
  await tx.$queryRaw`SELECT id FROM stories WHERE cluster_id = ${clusterId} ORDER BY id FOR UPDATE`
  const cluster = await tx.storyCluster.findUnique({
    where: { id: clusterId },
    select: {
      primaryStoryId: true,
      stories: { select: { id: true, status: true, rejectionReason: true, relevance: true, dateCrawled: true, datePublished: true } },
    },
  })
  if (!cluster) return { primaryId: null, rejected: [], restored: [] }

  const primary = chosenPrimaryId ? cluster.stories.find(m => m.id === chosenPrimaryId) : [...cluster.stories].filter(electable).sort(byElectionRank)[0]
  if (!primary) {
    const stale = cluster.primaryStoryId !== null && !cluster.stories.some(m => m.id === cluster.primaryStoryId)
    if (stale) await tx.storyCluster.update({ where: { id: clusterId }, data: { primaryStoryId: null } })
    return { primaryId: stale ? null : cluster.primaryStoryId, rejected: [], restored: [] }
  }

  if (primary.id !== cluster.primaryStoryId) {
    await tx.storyCluster.update({ where: { id: clusterId }, data: { primaryStoryId: primary.id } })
  }
  const restored = mode !== 'pipeline' && isDuplicate(primary) ? await restoreDuplicates(tx, { id: primary.id }) : []
  const rejectFrom = mode === 'editor-cluster' ? [...DUPLICATE_FROM, published] : DUPLICATE_FROM
  const rejectedIds = await moveWhere(
    tx,
    { clusterId, id: { not: primary.id }, status: { in: rejectFrom } },
    { to: rejected, reason: RejectionReason.duplicate },
  )
  forgetRelatedStories(rejectedIds)

  if (primary.id !== cluster.primaryStoryId || rejectedIds.length > 0 || restored.length > 0) {
    log.info({ clusterId, mode, primaryStoryId: primary.id, rejectedIds, restored }, 'cluster primary elected')
  }
  return { primaryId: primary.id, rejected: rejectedIds, restored }
}

/** Duplicate rejections back to `published` when they were published before, else `analyzed`. */
async function restoreDuplicates(tx: Tx, where: Prisma.StoryWhereInput): Promise<string[]> {
  const duplicates = { ...where, status: rejected, rejectionReason: RejectionReason.duplicate }
  const republished = await moveWhere(tx, { ...duplicates, datePublished: { not: null } }, { to: published })
  const requeued = await moveWhere(tx, { ...duplicates, datePublished: null }, { to: analyzed })
  republishedIn.get(tx)?.push(...republished)
  return [...republished, ...requeued]
}

// ──── Transactions ──────────────────────────────────────────────────────

/** Stories put back on the site in a transaction, keyed by its client, for after the commit. */
const republishedIn = new WeakMap<Tx, string[]>()

/**
 * Run `fn` in a transaction. Stories it put back on the site (restored duplicates) get their
 * embedding ensured after the commit, outside the transaction: the retention job clears the
 * embeddings of old unpublished stories (`story-retention.md`). A failure republishes without one.
 */
async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const republished: string[] = []
  const result = await prisma.$transaction(
    async tx => {
      republished.length = 0 // a retried callback starts over
      republishedIn.set(tx, republished)
      return fn(tx)
    },
    { timeout: config.database.transactionTimeoutMs },
  )
  if (republished.length > 0) {
    try {
      await ensureEmbeddings([...new Set(republished)])
    } catch (err) {
      log.warn({ err, storyCount: republished.length }, 'failed to ensure embeddings of restored stories, proceeding without')
    }
  }
  return result
}

// ──── Cluster edits ─────────────────────────────────────────────────────

/** Run `fn` in a transaction holding the row locks of these clusters; `locked` is those that exist. */
export async function withClusterLocks<T>(clusterIds: string[], fn: (tx: Tx, locked: Set<string>) => Promise<T>): Promise<T> {
  return inTransaction(async tx => fn(tx, await lockClusters(tx, clusterIds)))
}

/** Restore duplicate members, unlink every member and delete the cluster. */
export async function dissolveCluster(clusterId: string): Promise<{ restored: string[] }> {
  return withClusterLocks([clusterId], async (tx, locked) => {
    if (!locked.has(clusterId)) throw new NotFoundError('Cluster not found')
    const restored = await dissolveLocked(tx, clusterId)
    log.info({ clusterId, restored }, 'dissolved cluster')
    return { restored }
  })
}

async function dissolveLocked(tx: Tx, clusterId: string): Promise<string[]> {
  const restored = await restoreDuplicates(tx, { clusterId })
  await tx.story.updateMany({ where: { clusterId }, data: { clusterId: null } })
  await tx.storyCluster.delete({ where: { id: clusterId } })
  return restored
}

/**
 * Take a story out of its cluster, restoring it if it was a duplicate. A cluster left with one
 * member is dissolved; otherwise its primary is re-elected (editor-cluster mode).
 */
export async function removeFromCluster(clusterId: string, storyId: string): Promise<{ dissolved: boolean }> {
  return withClusterLocks([clusterId], async tx => {
    const story = await tx.story.findUnique({ where: { id: storyId }, select: { clusterId: true } })
    if (!story || story.clusterId !== clusterId) throw new BadRequestError('Story is not a member of this cluster')

    await tx.story.update({ where: { id: storyId }, data: { clusterId: null } })
    await restoreDuplicates(tx, { id: storyId })
    log.info({ clusterId, storyId }, 'removed story from cluster')

    if ((await tx.story.count({ where: { clusterId } })) <= 1) {
      await dissolveLocked(tx, clusterId)
      log.info({ clusterId }, 'dissolved cluster after member removal (<=1 remaining)')
      return { dissolved: true }
    }
    await reelectPrimary(clusterId, 'editor-cluster', tx)
    return { dissolved: false }
  })
}

/** Move every member of `sourceId` into `targetId`, delete the source and re-elect (editor-cluster). */
export async function mergeClusters(targetId: string, sourceId: string): Promise<void> {
  if (targetId === sourceId) throw new BadRequestError('Cannot merge a cluster with itself')
  await withClusterLocks([targetId, sourceId], async (tx, locked) => {
    // 400, not 404: the clusters are named in the request (the URL's and the body's)
    if (!locked.has(targetId)) throw new BadRequestError('Target cluster not found')
    if (!locked.has(sourceId)) throw new BadRequestError('Source cluster not found')
    await tx.story.updateMany({ where: { clusterId: sourceId }, data: { clusterId: targetId } })
    await tx.storyCluster.delete({ where: { id: sourceId } })
    await reelectPrimary(targetId, 'editor-cluster', tx)
    log.info({ targetId, sourceId }, 'merged clusters')
  })
}

// ──── Locks and reads ───────────────────────────────────────────────────

async function lockClusters(tx: Tx, clusterIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(clusterIds)].sort()
  if (ids.length === 0) return new Set()
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM story_clusters WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`
  return new Set(rows.map(r => r.id))
}

async function lockClustersOf(tx: Tx, storyIds: string[]): Promise<Set<string>> {
  const rows = await tx.story.findMany({ where: { id: { in: storyIds }, clusterId: { not: null } }, select: { clusterId: true } })
  return lockClusters(
    tx,
    rows.map(r => r.clusterId!),
  )
}

/** How often a transaction is tried when its stories keep joining clusters it has not locked. */
const CLUSTER_CHANGE_ATTEMPTS = 3

/** A story joined a cluster between the unlocked read of its cluster id and its row lock. */
export class ClusterChangedError extends Error {
  constructor(readonly clusterIds: string[]) {
    super(`stories joined clusters while being locked: ${clusterIds.join(', ')}`)
    this.name = 'ClusterChangedError'
  }
}

/**
 * The lock order for moving stories: their clusters' rows by id, then the story rows by id. The
 * cluster ids are read without a lock, so a story can join a cluster (a manual cluster, a dedup
 * formation, a merge) before its row is locked; locking that cluster now would invert the order
 * (a deadlock risk), so the transaction is abandoned with `ClusterChangedError` and run again by
 * `retryOnClusterChange`, which then locks the new cluster first.
 */
async function lockForMove(tx: Tx, ids: string[]): Promise<Map<string, LockedStory>> {
  const lockedClusters = await lockClustersOf(tx, ids)
  const stories = await lockStories(tx, ids)
  const appeared = new Set<string>()
  for (const { clusterId } of stories.values()) if (clusterId && !lockedClusters.has(clusterId)) appeared.add(clusterId)
  if (appeared.size > 0) throw new ClusterChangedError([...appeared].sort())
  return stories
}

/**
 * Run a transaction that calls `lockForMove`, again when a story joined an unlocked cluster
 * meanwhile, up to `CLUSTER_CHANGE_ATTEMPTS` times; then fail with a clear error. `run` must start
 * the whole transaction, so each attempt rolls back and takes its locks afresh.
 */
async function retryOnClusterChange<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (err) {
      if (!(err instanceof ClusterChangedError)) throw err
      if (attempt >= CLUSTER_CHANGE_ATTEMPTS) {
        throw new Error(`gave up moving stories after ${attempt} attempts: their clusters kept changing (${err.clusterIds.join(', ')})`, { cause: err })
      }
      log.info({ attempt, clusterIds: err.clusterIds }, 'stories joined a cluster while being locked; retrying the transaction')
    }
  }
}

/** Test-only: `retryOnClusterChange`, to exercise its bound without a race. */
export const _retryOnClusterChange = retryOnClusterChange

interface LockedStory {
  status: StoryStatus
  clusterId: string | null
  isPrimary: boolean
}

async function lockStories(tx: Tx, ids: string[]): Promise<Map<string, LockedStory>> {
  const rows = await tx.$queryRaw<{ id: string; status: StoryStatus; cluster_id: string | null; is_primary: boolean }[]>`
    SELECT s.id, s.status::text AS status, s.cluster_id, COALESCE(c.primary_story_id = s.id, false) AS is_primary
    FROM stories s LEFT JOIN story_clusters c ON c.id = s.cluster_id
    WHERE s.id = ANY(${ids}::text[])
    ORDER BY s.id
    FOR UPDATE OF s`
  return new Map(rows.map(r => [r.id, { status: r.status, clusterId: r.cluster_id, isPrimary: r.is_primary }]))
}

async function currentStatuses(client: Tx, ids: string[]): Promise<Map<string, StoryStatus>> {
  const rows = await client.story.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
  return new Map(rows.map(r => [r.id, r.status]))
}
