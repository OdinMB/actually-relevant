import { HumanMessage } from '@langchain/core/messages'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { buildDedupPrompt } from '../prompts/dedup.js'
import { dedupConfirmationSchema } from '../schemas/llm.js'
import { reelectPrimary, withClusterLocks } from './storyLifecycle.js'

const log = createLogger('dedup')

// ──── Types ──────────────────────────────────────────────────────────────────

interface NearestCandidate {
  id: string
  distance: number
  title: string
  summary: string
}

interface RawCandidateRow {
  id: string
  distance: number
  title: string | null
  summary: string | null
}

export interface DetectResult {
  clusterId: string | null
  newCluster: boolean
  memberCount: number
  rejectedIds: string[]
}

// ──── Stage 1: Find nearest candidates by cosine distance ────────────────────

export async function findNearestCandidates(
  storyId: string,
  options?: {
    limit?: number
    timeWindowDays?: number
  },
): Promise<NearestCandidate[]> {
  const limit = options?.limit ?? config.dedup.maxCandidates
  const timeWindowDays = options?.timeWindowDays ?? config.dedup.timeWindowDays

  const rows = await prisma.$queryRaw<RawCandidateRow[]>`
    SELECT s.id, s.title, s.summary,
           s.embedding <=> (SELECT embedding FROM stories WHERE id = ${storyId}) AS distance
    FROM stories s
    LEFT JOIN story_clusters sc ON sc.id = s.cluster_id
    WHERE s.id != ${storyId}
      AND s.status IN ('analyzed', 'selected', 'published')
      AND s.embedding IS NOT NULL
      AND s.date_crawled > NOW() - ${timeWindowDays} * INTERVAL '1 day'
      AND (s.cluster_id IS NULL OR sc.primary_story_id = s.id)
    ORDER BY distance ASC
    LIMIT ${limit}
  `

  return rows
    .filter((r): r is RawCandidateRow & { title: string; summary: string } =>
      r.title != null && r.summary != null)
    .map(r => ({
      id: r.id,
      distance: Number(r.distance),
      title: r.title,
      summary: r.summary,
    }))
}

// ──── Stage 2: LLM confirmation ─────────────────────────────────────────────

export async function confirmDuplicates(
  sourceStory: { title: string; summary: string },
  candidates: { id: string; title: string; summary: string }[],
): Promise<{ id: string; isDuplicate: boolean; reason: string }[]> {
  if (candidates.length === 0) return []

  log.info({ candidateCount: candidates.length, sourceTitle: sourceStory.title.slice(0, 80) }, 'sending dedup confirmation to LLM')

  const prompt = buildDedupPrompt(sourceStory, candidates)

  await rateLimitDelay()
  const llm = getLLMByTier(config.dedup.modelTier)
  const structuredLlm = llm.withStructuredOutput(dedupConfirmationSchema)
  const response = await structuredLlm.invoke([new HumanMessage(prompt)])

  const confirmed = response.assessments.filter(a => a.isDuplicate).length
  log.info({ candidateCount: candidates.length, confirmedCount: confirmed }, 'LLM dedup confirmation complete')

  return response.assessments.map(a => {
    const candidate = candidates[a.candidateNumber - 1]
    if (!candidate) {
      log.warn({ candidateNumber: a.candidateNumber, total: candidates.length }, 'LLM returned out-of-range candidate number')
      return null
    }
    return {
      id: candidate.id,
      isDuplicate: a.isDuplicate,
      reason: a.reason,
    }
  }).filter((r): r is NonNullable<typeof r> => r != null)
}

// ──── Stage 3: Cluster management ────────────────────────────────────────────

export async function findExistingCluster(storyIds: string[]): Promise<{ id: string; otherClusterIds?: string[] } | null> {
  const stories = await prisma.story.findMany({
    where: {
      id: { in: storyIds },
      clusterId: { not: null },
    },
    select: { clusterId: true, dateCrawled: true },
    orderBy: { dateCrawled: 'desc' },
  })

  if (stories.length === 0) return null

  // Pick the cluster of the newest duplicate
  const primaryClusterId = stories[0]!.clusterId!

  // Check for multi-cluster collision
  const uniqueClusterIds = [...new Set(stories.map(s => s.clusterId!))]
  const otherClusterIds = uniqueClusterIds.filter(id => id !== primaryClusterId)

  if (otherClusterIds.length > 0) {
    log.warn(
      { targetCluster: primaryClusterId, otherClusters: otherClusterIds, duplicateIds: storyIds },
      'multi-cluster collision: duplicates span multiple clusters, joining newest'
    )
  }

  return {
    id: primaryClusterId,
    ...(otherClusterIds.length > 0 ? { otherClusterIds } : {}),
  }
}

/**
 * Join the story and its unclustered duplicates to `existingClusterId` (or to a new cluster when
 * there is none, or it was dissolved meanwhile), then elect the primary and auto-reject the other
 * members in pipeline mode: one transaction holding the cluster's row lock. Only stories still
 * unclustered join, so a story another write clustered meanwhile keeps its cluster.
 */
async function formCluster(storyId: string, duplicateIds: string[], existingClusterId: string | null): Promise<DetectResult> {
  const joining = [storyId, ...duplicateIds]
  try {
    return await withClusterLocks(existingClusterId ? [existingClusterId] : [], async (tx, locked) => {
      const existing = existingClusterId && locked.has(existingClusterId) ? existingClusterId : null
      const clusterId = existing ?? (await tx.storyCluster.create({ data: {} })).id
      await tx.story.updateMany({ where: { id: { in: joining }, clusterId: null }, data: { clusterId } })
      const memberCount = await tx.story.count({ where: { clusterId } })
      // The stories were clustered elsewhere meanwhile: a cluster of one is no cluster
      if (memberCount < 2) throw new TooFewMembers()
      const { rejected } = await reelectPrimary(clusterId, 'pipeline', tx)
      log.info({ storyId, clusterId, memberCount, newCluster: !existing }, existing ? 'added story to existing cluster' : 'created new cluster')
      return { clusterId, newCluster: !existing, memberCount, rejectedIds: rejected }
    })
  } catch (err) {
    if (!(err instanceof TooFewMembers)) throw err
    log.info({ storyId, duplicateIds }, 'dedup cluster not formed: the stories joined other clusters meanwhile')
    return { clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] }
  }
}

/** Rolls back a cluster formation that would leave fewer than two members. */
class TooFewMembers extends Error {}

// ──── Full pipeline ──────────────────────────────────────────────────────────

export async function detectAndCluster(storyId: string): Promise<DetectResult> {
  if (!config.dedup.enabled) {
    return { clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] }
  }

  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { id: true, title: true, summary: true, clusterId: true },
  })

  if (!story?.title || !story?.summary) {
    log.warn({ storyId }, 'story missing title or summary, skipping dedup')
    return { clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] }
  }

  // Already in a cluster
  if (story.clusterId) {
    log.info({ storyId, clusterId: story.clusterId }, 'story already in a cluster, skipping')
    return { clusterId: story.clusterId, newCluster: false, memberCount: 0, rejectedIds: [] }
  }

  // Stage 1: Find nearest candidates
  const candidates = await findNearestCandidates(storyId)
  if (candidates.length === 0) {
    log.debug({ storyId }, 'no embedding candidates found')
    return { clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] }
  }

  log.info({ storyId, candidateCount: candidates.length, nearestDistance: candidates[0]!.distance }, 'found dedup candidates')

  // Stage 2: LLM confirmation
  const results = await confirmDuplicates(
    { title: story.title, summary: story.summary },
    candidates,
  )
  const duplicateIds = results.filter(r => r.isDuplicate).map(r => r.id)

  if (duplicateIds.length === 0) {
    log.info({ storyId }, 'no confirmed duplicates')
    return { clusterId: null, newCluster: false, memberCount: 0, rejectedIds: [] }
  }

  log.info({ storyId, confirmedDuplicates: duplicateIds.length }, 'LLM confirmed duplicates')

  // Stage 3: Create or join cluster, elect, auto-reject (one transaction)
  const existingCluster = await findExistingCluster(duplicateIds)
  return formCluster(storyId, duplicateIds, existingCluster?.id ?? null)
}
