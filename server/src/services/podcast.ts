import prisma from '../lib/prisma.js'
import { type Prisma, ContentStatus, PodcastStage } from '@prisma/client'
import { paginate } from '../lib/paginate.js'

interface PodcastFilters {
  status?: string
  stage?: string
  page?: number
  pageSize?: number
}

/** List columns only: the dialogue, script and show notes stay out of list queries. */
const LIST_COLUMNS = {
  id: true,
  title: true,
  status: true,
  stage: true,
  weekKey: true,
  storyIds: true,
  attempts: true,
  blockedAt: true,
  lastError: true,
  dryRun: true,
  leaseUntil: true,
  createdAt: true,
  updatedAt: true,
} as const

/** `inProgress` while a process holds a live lease on the episode's stage machine. */
function withProgress<T extends { leaseUntil: Date | null }>(row: T, now = new Date()): T & { inProgress: boolean } {
  return { ...row, inProgress: row.leaseUntil != null && row.leaseUntil > now }
}

export async function getPodcasts(filters: PodcastFilters) {
  const page = filters.page || 1
  const pageSize = filters.pageSize || 25
  const where: Prisma.PodcastWhereInput = {}
  if (filters.status) where.status = filters.status as ContentStatus
  if (filters.stage) where.stage = filters.stage as PodcastStage

  return paginate({
    findMany: async () => {
      const rows = await prisma.podcast.findMany({
        where,
        select: LIST_COLUMNS,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      return rows.map(r => withProgress(r))
    },
    count: () => prisma.podcast.count({ where }),
    page,
    pageSize,
  })
}

export async function getPodcastById(id: string) {
  const row = await prisma.podcast.findUnique({ where: { id } })
  return row ? withProgress(row) : null
}

export async function updatePodcastTitle(id: string, title: string) {
  return withProgress(await prisma.podcast.update({ where: { id }, data: { title } }))
}

export async function deletePodcast(id: string) {
  await prisma.podcast.delete({ where: { id } })
}
