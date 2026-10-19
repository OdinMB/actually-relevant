/**
 * Writes to story rows: create, admin edit, status changes and publishing (with slug assignment
 * under the shared slug lock), delete and per-story cluster dissolve. Every `stories.status` write
 * in this service lives here, so the status writers stay in one place.
 */
import prisma from '../lib/prisma.js'
import { type Story, Prisma, StoryStatus } from '@prisma/client'
import { slugify } from '../utils/slugify.js'
import { generateEmbeddingForContent, ensureEmbedding, ensureEmbeddings } from './embedding.js'
import { fetchStoryForEmbedding, saveEmbeddingTx } from '../lib/vectors.js'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'
import type { ExtractionMethod } from './extractor.js'
import type { AccessTier } from '../lib/paywall.js'
import type { z } from 'zod'
import type { updateStorySchema } from '../schemas/story.js'
import { repairClusters } from './clusterRepair.js'
import { forgetRelatedStories } from './relatedStories.js'
import { BadRequestError } from '../utils/errors.js'

const log = createLogger('story')

// Application-defined key for the transaction-scoped advisory lock that serializes
// slug assignment across all concurrent publishers (see withSlugLock).
const SLUG_ASSIGNMENT_LOCK_KEY = 247_834_001

/**
 * Run `fn` inside a transaction holding the slug-assignment advisory lock. Every code
 * path that auto-generates a slug must go through here: slug assignment is a
 * read-modify-write over the global (unique) slug namespace, so without serialization
 * two concurrent publishers can pick the same slug for different stories and one fails
 * with P2002. The lock is always acquired BEFORE any row write, so no advisory⇄row lock
 * cycle can form; it auto-releases on commit/rollback. Holders only do fast set-based
 * work, so contention blocks briefly in practice.
 */
async function withSlugLock<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // Use $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns Postgres `void`,
    // and $queryRaw tries to deserialize the result column and throws P2010
    // ("Failed to deserialize column of type 'void'"). $executeRaw runs the statement
    // (acquiring the lock) and returns a row count, deserializing nothing.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLUG_ASSIGNMENT_LOCK_KEY}::bigint)`
    return fn(tx)
  }, { timeout: config.database.transactionTimeoutMs })
}

export async function generateUniqueSlug(
  title: string,
  excludeId?: string,
  client: Prisma.TransactionClient = prisma,
): Promise<string> {
  const base = slugify(title)
  let candidate = base
  let suffix = 2

  while (true) {
    const existing = await client.story.findFirst({
      where: {
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (!existing) return candidate
    candidate = `${base}-${suffix}`
    suffix++
  }
}

export async function generateUniqueSlugs(
  stories: { id: string; title: string | null; sourceTitle: string }[],
  // Pass the transaction client when generating under an advisory lock so the
  // existing-slug read and the slug write see a consistent namespace.
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, string>> {
  if (stories.length === 0) return new Map()

  // Generate base slugs for all stories
  const baseSlugs = stories.map(s => ({
    id: s.id,
    base: slugify(s.title || s.sourceTitle),
  }))

  // Find all existing slugs that could conflict (matching any base pattern)
  const uniqueBases = [...new Set(baseSlugs.map(s => s.base))]
  const existingStories = await client.story.findMany({
    where: {
      slug: { not: null },
      id: { notIn: stories.map(s => s.id) },
      OR: uniqueBases.map(base => ({
        slug: { startsWith: base },
      })),
    },
    select: { slug: true },
  })
  const existingSlugs = new Set(existingStories.map(s => s.slug!))

  // Resolve conflicts: track slugs we're assigning in this batch too
  const assignedSlugs = new Set<string>()
  const result = new Map<string, string>()

  for (const { id, base } of baseSlugs) {
    let candidate = base
    let suffix = 2
    while (existingSlugs.has(candidate) || assignedSlugs.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix++
    }
    assignedSlugs.add(candidate)
    result.set(id, candidate)
  }

  return result
}

interface PublishData {
  datePublished?: Date
  slug?: string
}

async function preparePublishData(
  id: string,
  client: Prisma.TransactionClient = prisma,
): Promise<PublishData> {
  const story = await client.story.findUnique({
    where: { id },
    select: { datePublished: true, slug: true, title: true, sourceTitle: true },
  })
  if (!story) return {}
  const data: PublishData = {}
  if (!story.datePublished) data.datePublished = new Date()
  if (!story.slug) data.slug = await generateUniqueSlug(story.title || story.sourceTitle, id, client)
  return data
}

export async function createStory(data: {
  sourceUrl: string
  sourceTitle: string
  sourceContent: string
  feedId: string
  sourceDatePublished?: string
  crawlMethod?: ExtractionMethod
  accessTier?: AccessTier
}): Promise<Story> {
  const feed = await prisma.feed.findUnique({ where: { id: data.feedId } })
  if (!feed) {
    throw new BadRequestError('Feed not found')
  }
  return prisma.story.create({
    data: {
      sourceUrl: data.sourceUrl,
      sourceTitle: data.sourceTitle,
      sourceContent: data.sourceContent,
      feedId: data.feedId,
      sourceDatePublished: data.sourceDatePublished ? new Date(data.sourceDatePublished) : null,
      crawlMethod: data.crawlMethod || null,
      accessTier: data.accessTier ?? null,
      // A paywall-locked story is rejected at crawl, before any model call (ADR-0031); an editor's
      // re-assess, re-queue or publish is the override.
      status: data.accessTier === 'locked' ? StoryStatus.rejected : StoryStatus.fetched,
    },
  })
}

/** An admin edit of a story: the validated body of `PUT /api/admin/stories/:id`. */
export type StoryUpdate = z.infer<typeof updateStorySchema>

/**
 * Apply an admin edit. A story that is or becomes published gets its embedding brought up to date
 * before the write, whatever fields the edit carries: an edit of its title, label or summary
 * regenerates it and fails the edit if that fails; a publish without such an edit generates a
 * missing one (retention clears old unpublished stories' embeddings) and, like the other publish
 * paths, goes ahead without it if generation fails.
 */
export async function updateStory(id: string, input: StoryUpdate): Promise<Story> {
  const { sourceDatePublished, ...fields } = input
  const updateData: Prisma.StoryUncheckedUpdateInput = {
    ...fields,
    ...(sourceDatePublished !== undefined && {
      sourceDatePublished: sourceDatePublished ? new Date(sourceDatePublished) : null,
    }),
  }
  // A publish may need an auto-generated slug and date; that read-modify-write runs under the
  // shared slug lock (runWrite below).
  const publishing = input.status === StoryStatus.published

  // The embedding is generated via a slow external call BEFORE any transaction, then persisted
  // alongside the update.
  const contentEdited = input.title !== undefined || input.titleLabel !== undefined || input.summary !== undefined
  let embeddingData: Awaited<ReturnType<typeof generateEmbeddingForContent>> = null
  if (contentEdited || publishing) {
    const currentStory = await fetchStoryForEmbedding(id)
    // No row: the update below fails with P2025 (404)
    if (currentStory && (publishing || currentStory.status === StoryStatus.published)) {
      const merged = {
        ...currentStory,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.titleLabel !== undefined ? { titleLabel: input.titleLabel } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      }
      try {
        // null when the stored embedding already matches the content
        embeddingData = await generateEmbeddingForContent(merged)
      } catch (err) {
        if (contentEdited) throw err
        log.warn({ err, storyId: id }, 'failed to ensure embedding on publish, proceeding without')
      }
    }
  }

  // A plain update suffices only when we neither auto-assign a slug nor persist an embedding.
  if (!publishing && !embeddingData) {
    const story = await prisma.story.update({ where: { id }, data: updateData })
    if (story.status !== StoryStatus.published) forgetRelatedStories([id])
    return story
  }

  // Otherwise write transactionally. Acquire the slug lock only when auto-assigning a slug.
  const runWrite = async (tx: Prisma.TransactionClient): Promise<Story> => {
    if (publishing) {
      const publishData = await preparePublishData(id, tx)
      if (!updateData.slug && publishData.slug) updateData.slug = publishData.slug
      if (publishData.datePublished) updateData.datePublished = publishData.datePublished
    }
    const story = await tx.story.update({ where: { id }, data: updateData })
    if (embeddingData) {
      await saveEmbeddingTx(tx, id, embeddingData.embedding, embeddingData.hash)
    }
    return story
  }

  return publishing
    ? withSlugLock(runWrite)
    : prisma.$transaction(runWrite)
}

export async function updateStoryStatus(id: string, status: string): Promise<Story> {
  if (status === 'published') {
    // ensureEmbedding makes slow external calls, so it stays OUTSIDE the lock/tx.
    await ensureEmbedding(id)
    // Slug auto-assignment + write run under the shared slug lock (see withSlugLock).
    return withSlugLock(async (tx) => {
      const data = { status: status as StoryStatus, ...(await preparePublishData(id, tx)) }
      return tx.story.update({ where: { id }, data })
    })
  }
  const story = await prisma.story.update({ where: { id }, data: { status: status as StoryStatus } })
  forgetRelatedStories([id])
  return story
}

/**
 * Publish a single bounded chunk of stories: ensure embeddings exist, then flip
 * status to `published` (assigning slugs as needed) under the shared slug lock.
 * Returns the number of rows actually transitioned. Kept small on purpose — see
 * bulkUpdateStatus for why publishing is chunked.
 */
async function publishChunk(ids: string[]): Promise<number> {
  // Ensure all stories have embeddings (no-op for already-embedded stories).
  // This makes slow external calls, so it stays OUTSIDE the transaction.
  await ensureEmbeddings(ids)

  const now = new Date()
  // The slug read-modify-write and the status flip run under the shared slug lock so
  // concurrent publishers can't assign the same slug to different stories (P2002).
  return withSlugLock(async (tx) => {
    // Batch-generate slugs for stories that don't have one yet.
    const storiesNeedingSlugs = await tx.story.findMany({
      where: { id: { in: ids }, slug: null },
      select: { id: true, title: true, sourceTitle: true },
    })
    const slugMap = await generateUniqueSlugs(storiesNeedingSlugs, tx)

    // Assign all slugs in a single statement. A per-story update loop here costs
    // one DB round-trip per story, which blows past the transaction timeout once
    // the chunk grows. Every new slug is unique by construction
    // (see generateUniqueSlugs), so a batched UPDATE can't violate the constraint.
    if (slugMap.size > 0) {
      const slugRows = [...slugMap.entries()].map(
        ([storyId, slug]) => Prisma.sql`(${storyId}::text, ${slug}::text)`,
      )
      await tx.$executeRaw`
        UPDATE stories AS s
        SET slug = v.slug
        FROM (VALUES ${Prisma.join(slugRows)}) AS v(id, slug)
        WHERE s.id = v.id
      `
    }
    const alreadyDated = await tx.story.updateMany({
      where: { id: { in: ids }, datePublished: { not: null } },
      data: { status: StoryStatus.published },
    })
    const newlyDated = await tx.story.updateMany({
      where: { id: { in: ids }, datePublished: null },
      data: { status: StoryStatus.published, datePublished: now },
    })
    // Report rows actually transitioned, not ids.length — an id may have been
    // deleted between selection and publish and should not be counted.
    return alreadyDated.count + newlyDated.count
  })
}

export async function bulkUpdateStatus(ids: string[], status: string) {
  if (status === 'published') {
    // Publish in bounded chunks so the per-chunk embedding fetch/accumulation and the
    // slug-locked transaction stay small no matter how large the `selected` backlog
    // (or an admin bulk selection) is — this is what keeps the publish job within
    // Render's memory limit and under the transaction timeout. Each chunk commits
    // independently: a failure on a later chunk leaves earlier chunks published, and
    // the next run resumes from the remaining `selected` stories.
    let publishedCount = 0
    for (let i = 0; i < ids.length; i += config.publish.chunkSize) {
      publishedCount += await publishChunk(ids.slice(i, i + config.publish.chunkSize))
    }
    return { count: publishedCount }
  }
  const result = await prisma.story.updateMany({
    where: { id: { in: ids } },
    data: { status: status as StoryStatus },
  })
  forgetRelatedStories(ids)
  return result
}

export async function publishStory(id: string): Promise<Story> {
  // ensureEmbedding makes slow external calls, so it stays OUTSIDE the lock/tx.
  await ensureEmbedding(id)
  // Slug auto-assignment + write run under the shared slug lock (see withSlugLock).
  return withSlugLock(async (tx) => {
    const publishData = await preparePublishData(id, tx)
    return tx.story.update({
      where: { id },
      data: {
        status: StoryStatus.published,
        ...publishData,
      },
    })
  })
}

export async function rejectStory(id: string): Promise<Story> {
  const story = await prisma.story.update({
    where: { id },
    data: { status: StoryStatus.rejected },
  })
  forgetRelatedStories([id])
  return story
}

export async function deleteStory(id: string): Promise<void> {
  // Check cluster membership before deletion
  const storyCluster = await prisma.story.findUnique({
    where: { id },
    select: { clusterId: true },
  })

  await prisma.story.delete({ where: { id } })
  forgetRelatedStories([id])

  // Dissolve a cluster left with one member, or re-elect its primary (the same repair as retention)
  if (storyCluster?.clusterId) await repairClusters([storyCluster.clusterId])

  // Clean up dangling storyId references in newsletters and podcasts
  const [newsletters, podcasts] = await Promise.all([
    prisma.newsletter.findMany({ where: { storyIds: { has: id } }, select: { id: true, storyIds: true } }),
    prisma.podcast.findMany({ where: { storyIds: { has: id } }, select: { id: true, storyIds: true } }),
  ])

  const updates: Promise<unknown>[] = []
  for (const nl of newsletters) {
    updates.push(prisma.newsletter.update({
      where: { id: nl.id },
      data: { storyIds: nl.storyIds.filter(sid => sid !== id) },
    }))
  }
  for (const pod of podcasts) {
    updates.push(prisma.podcast.update({
      where: { id: pod.id },
      data: { storyIds: pod.storyIds.filter(sid => sid !== id) },
    }))
  }
  if (updates.length > 0) await Promise.all(updates)
}

export async function dissolveCluster(storyId: string): Promise<void> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { clusterId: true },
  })

  if (!story?.clusterId) {
    throw new BadRequestError('Story is not in a cluster')
  }

  const clusterId = story.clusterId

  // Restore auto-rejected members to analyzed
  await prisma.story.updateMany({
    where: {
      clusterId,
      status: 'rejected',
    },
    data: { status: 'analyzed' },
  })

  // Remove all members from cluster
  await prisma.story.updateMany({
    where: { clusterId },
    data: { clusterId: null },
  })

  // Delete the cluster record
  await prisma.storyCluster.delete({ where: { id: clusterId } })

  log.info({ clusterId, triggeredBy: storyId }, 'dissolved cluster via admin action')
}
