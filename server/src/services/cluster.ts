/**
 * Cluster reads, argument checks and the editor's cluster edits. Every edit runs in one
 * transaction holding the cluster's row lock, and every status change it implies (election,
 * auto-reject, restore) is the lifecycle module's (`storyLifecycle.ts`, editor-cluster mode).
 */
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js'
import * as lifecycle from './storyLifecycle.js'

/** 409: some of the stories are already in a cluster; the body lists their ids. */
export class StoriesAlreadyClusteredError extends ConflictError {
  constructor(message: string, readonly storyIds: string[]) {
    super(message)
  }

  override toBody() {
    return { error: this.message, storyIds: this.storyIds }
  }
}

const log = createLogger('cluster')

const CLUSTER_STORY_SELECT = {
  id: true,
  title: true,
  sourceTitle: true,
  status: true,
  relevance: true,
} as const

export async function getAllClusters() {
  return prisma.storyCluster.findMany({
    include: {
      primaryStory: { select: { id: true, title: true, sourceTitle: true } },
      _count: { select: { stories: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getClusterById(id: string) {
  return prisma.storyCluster.findUnique({
    where: { id },
    include: {
      primaryStory: { select: { id: true, title: true, sourceTitle: true } },
      stories: {
        select: {
          ...CLUSTER_STORY_SELECT,
          feed: { select: { title: true } },
        },
        orderBy: { dateCrawled: 'asc' },
      },
      _count: { select: { stories: true } },
    },
  })
}

function alreadyClustered(stories: { id: string; title: string | null }[]): StoriesAlreadyClusteredError {
  const titles = stories.map(s => s.title ?? s.id)
  return new StoriesAlreadyClusteredError(`Stories already in a cluster: ${titles.join(', ')}`, stories.map(s => s.id))
}

export async function createManualCluster(storyIds: string[], primaryStoryId: string) {
  if (storyIds.length < 2) {
    throw new BadRequestError('At least 2 stories are required to create a cluster')
  }
  if (!storyIds.includes(primaryStoryId)) {
    throw new BadRequestError('Primary story must be one of the selected stories')
  }

  // Verify all stories exist and none are already clustered (the write below checks again)
  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds } },
    select: { id: true, clusterId: true, title: true },
  })

  if (stories.length !== storyIds.length) {
    const foundIds = new Set(stories.map(s => s.id))
    const missing = storyIds.filter(id => !foundIds.has(id))
    throw new NotFoundError(`Stories not found: ${missing.join(', ')}`)
  }

  const clustered = stories.filter(s => s.clusterId !== null)
  if (clustered.length > 0) throw alreadyClustered(clustered)

  const clusterId = await lifecycle.withClusterLocks([], async (tx) => {
    const cluster = await tx.storyCluster.create({ data: {} })
    // Joins only stories still unclustered; a story another write clustered meanwhile rolls it all back
    const { count } = await tx.story.updateMany({
      where: { id: { in: storyIds }, clusterId: null },
      data: { clusterId: cluster.id },
    })
    if (count !== storyIds.length) {
      const taken = await tx.story.findMany({
        where: { id: { in: storyIds }, clusterId: { not: cluster.id } },
        select: { id: true, title: true },
      })
      throw alreadyClustered(taken)
    }
    await lifecycle.reelectPrimary(cluster.id, 'editor-cluster', tx, primaryStoryId)
    return cluster.id
  })

  log.info({ clusterId, primaryStoryId, memberCount: storyIds.length }, 'manually created cluster')
  return getClusterById(clusterId)
}

export async function searchStoriesForCluster(query: string, limit = 20) {
  return prisma.story.findMany({
    where: {
      status: { not: 'trashed' },
      title: { contains: query, mode: 'insensitive' },
    },
    select: {
      id: true,
      title: true,
      sourceTitle: true,
      status: true,
      relevance: true,
      clusterId: true,
    },
    orderBy: { dateCrawled: 'desc' },
    take: limit,
  })
}

export async function setClusterPrimary(clusterId: string, storyId: string) {
  await lifecycle.withClusterLocks([clusterId], async (tx) => {
    const story = await tx.story.findUnique({ where: { id: storyId }, select: { clusterId: true } })
    if (!story || story.clusterId !== clusterId) {
      throw new BadRequestError('Story is not a member of this cluster')
    }
    await lifecycle.reelectPrimary(clusterId, 'editor-cluster', tx, storyId)
  })
  log.info({ clusterId, primaryStoryId: storyId }, 'manually set cluster primary')
  return getClusterById(clusterId)
}

/** The cluster after the removal, or null when it was dissolved (one member or none left). */
export async function removeFromCluster(clusterId: string, storyId: string) {
  const { dissolved } = await lifecycle.removeFromCluster(clusterId, storyId)
  return dissolved ? null : getClusterById(clusterId)
}

export async function mergeClusters(targetId: string, sourceId: string) {
  await lifecycle.mergeClusters(targetId, sourceId)
  return getClusterById(targetId)
}

export async function dissolveCluster(clusterId: string): Promise<void> {
  await lifecycle.dissolveCluster(clusterId)
}
