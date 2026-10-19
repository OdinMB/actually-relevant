/**
 * Writes to story rows from the admin: create, edit, status changes, delete and per-story cluster
 * dissolve. Status changes are the lifecycle module's (`storyLifecycle.ts`, the only status
 * writer); the functions here turn an editor's request into a move and answer with the story.
 */
import prisma from '../lib/prisma.js'
import { type Story, Prisma, StoryStatus } from '@prisma/client'
import { generateEmbeddingForContent } from './embedding.js'
import { fetchStoryForEmbedding, saveEmbeddingTx } from '../lib/vectors.js'
import { createLogger } from '../lib/logger.js'
import type { ExtractionMethod } from './extractor.js'
import type { AccessTier } from '../lib/paywall.js'
import type { z } from 'zod'
import type { updateStorySchema } from '../schemas/story.js'
import { repairClusters } from './clusterRepair.js'
import { forgetRelatedStories } from './relatedStories.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'
import { editorMoveTo, initialStatus, transition } from './storyLifecycle.js'

const log = createLogger('story')

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
      ...initialStatus(data.accessTier),
    },
  })
}

/** An admin edit of a story: the validated body of `PUT /api/admin/stories/:id`. */
export type StoryUpdate = z.infer<typeof updateStorySchema>

/**
 * Apply an admin edit: the fields first, then, if the edit names a status, the editor's move to
 * it (two steps, decision 13 of the lifecycle plan: a refused move leaves the saved fields). An
 * edit of a published story's title, label or summary regenerates its embedding before the write
 * and fails the edit if that fails; a publish ensures the embedding as every publish does.
 */
export async function updateStory(id: string, input: StoryUpdate): Promise<Story> {
  const { sourceDatePublished, status, ...fields } = input
  const updateData: Prisma.StoryUncheckedUpdateInput = {
    ...fields,
    ...(sourceDatePublished !== undefined && {
      sourceDatePublished: sourceDatePublished ? new Date(sourceDatePublished) : null,
    }),
  }

  // A status-only edit writes no fields; anything else (an empty edit included, which answers 404
  // for an unknown story) goes through the field write
  if (!status || Object.keys(updateData).length > 0) await writeFields(id, input, updateData)
  return status ? moveOne(id, status) : prisma.story.findUniqueOrThrow({ where: { id } })
}

async function writeFields(id: string, input: StoryUpdate, updateData: Prisma.StoryUncheckedUpdateInput): Promise<void> {
  // The embedding is generated via a slow external call BEFORE any transaction
  const contentEdited = input.title !== undefined || input.titleLabel !== undefined || input.summary !== undefined
  let embeddingData: Awaited<ReturnType<typeof generateEmbeddingForContent>> = null
  if (contentEdited) {
    const currentStory = await fetchStoryForEmbedding(id)
    // No row: the update below fails with P2025 (404)
    if (currentStory?.status === StoryStatus.published) {
      // null when the stored embedding already matches the content; throws on failure
      embeddingData = await generateEmbeddingForContent({
        ...currentStory,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.titleLabel !== undefined ? { titleLabel: input.titleLabel } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
      })
    }
  }

  if (!embeddingData) {
    const story = await prisma.story.update({ where: { id }, data: updateData })
    if (story.status !== StoryStatus.published) forgetRelatedStories([id])
    return
  }
  const { embedding, hash } = embeddingData
  await prisma.$transaction(async (tx) => {
    await tx.story.update({ where: { id }, data: updateData })
    await saveEmbeddingTx(tx, id, embedding, hash)
  })
}

/**
 * The editor's move of one story to `status`, answering with the story. A story already there is
 * left as it is (a no-op, not an error); an unknown one is a 404.
 */
async function moveOne(id: string, status: StoryStatus): Promise<Story> {
  const { skipped } = await transition([id], editorMoveTo(status), 'editor')
  if (skipped.length > 0 && skipped[0].status === null) throw new NotFoundError('Story not found')
  return prisma.story.findUniqueOrThrow({ where: { id } })
}

export async function updateStoryStatus(id: string, status: StoryStatus): Promise<Story> {
  return moveOne(id, status)
}

/** The editor's move of many stories; ids already at `status` (or unknown) come back as skipped. */
export async function bulkUpdateStatus(ids: string[], status: StoryStatus): Promise<{ updated: number; skipped: string[] }> {
  const { moved, skipped } = await transition(ids, editorMoveTo(status), 'editor')
  return { updated: moved.length, skipped: skipped.map(s => s.id) }
}

export async function publishStory(id: string): Promise<Story> {
  return moveOne(id, StoryStatus.published)
}

export async function rejectStory(id: string): Promise<Story> {
  return moveOne(id, StoryStatus.rejected)
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
