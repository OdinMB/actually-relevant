/**
 * Reading and deleting podcast episodes for the admin: the list, one episode with its derived
 * state (in progress, what is running, waiting for review, the voicing estimate), the episodes a
 * process is working on right now, and delete with its guards. Changes go through the pipeline,
 * the weekly runs, `podcastEditing.ts` and `podcastPublish.ts`.
 */
import prisma from '../lib/prisma.js'
import { type Prisma, type Podcast, ContentStatus, PodcastStage } from '@prisma/client'
import { paginate } from '../lib/paginate.js'
import { assertChangeable, episodeTtsChars } from './podcastGuards.js'
import { deleteEpisodeObjects, episodeChunks } from './podcastAudioStages.js'
import { chunkChars } from './podcastChunks.js'
import { pausesForReview } from './podcastPipeline.js'
import { publishBlockedReason } from './podcastPublish.js'

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
  mode: true,
  weekKey: true,
  kind: true,
  storyIds: true,
  attempts: true,
  blockedAt: true,
  lastError: true,
  dryRun: true,
  leaseUntil: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

type ProgressFields = Pick<Podcast, 'leaseUntil' | 'mode' | 'stage' | 'lastError' | 'blockedAt'>

/**
 * `inProgress` while a process holds a live lease on the episode; `awaitingReview` when an
 * interactive episode rests at a review stop without an error or a block (derived, never stored).
 */
function withProgress<T extends ProgressFields>(row: T, now = new Date()): T & { inProgress: boolean; awaitingReview: boolean } {
  const inProgress = row.leaseUntil != null && row.leaseUntil > now
  const awaitingReview = !inProgress && !row.lastError && !row.blockedAt && pausesForReview(row)
  return { ...row, inProgress, awaitingReview }
}

/** What a run does next from each stage: the step the progress toast and the stepper name. */
const ACTIVITY: Partial<Record<PodcastStage, string>> = {
  created: 'Selecting stories',
  selected: 'Writing the script',
  scripted: 'Voicing',
  voiced: 'Assembling and uploading',
}

/** The step running on an episode in progress, named after the stage it is leaving; null at rest. */
export function episodeActivity(row: { stage: PodcastStage; inProgress: boolean }): string | null {
  return row.inProgress ? ACTIVITY[row.stage] ?? null : null
}

/** Spoken characters a full voicing of the stored dialogue sends to TTS; null before there is a script. */
function ttsCharsEstimate(row: Pick<Podcast, 'id' | 'dialogue' | 'kind'>): number | null {
  if (!row.dialogue) return null
  return episodeChunks(row).reduce((n, chunk) => n + chunkChars(chunk), 0)
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

/**
 * One episode with its derived state: `inProgress`, `awaitingReview`, the running `activity`, the
 * TTS characters spent on it (`ttsChars`, every re-voice included) and the characters a voicing of
 * the current script would send (`ttsCharsEstimate`, for the confirmation before any voicing), and
 * why it cannot be published now (`publishBlockedReason`, null when it can).
 */
export async function getPodcastById(id: string) {
  const row = await prisma.podcast.findUnique({ where: { id } })
  if (!row) return null
  const view = withProgress(row)
  return {
    ...view,
    activity: episodeActivity(view),
    publishBlockedReason: publishBlockedReason(row, view.inProgress),
    ttsCharsEstimate: row.stage === PodcastStage.legacy ? null : ttsCharsEstimate(row),
    ttsChars: row.stage === PodcastStage.legacy ? 0 : await episodeTtsChars(id),
  }
}

export interface ActiveEpisode {
  id: string
  title: string
  stage: PodcastStage
  mode: Podcast['mode']
  activity: string | null
  /** While voicing: chunks stored so far and the episode's total; otherwise null. */
  chunksDone: number | null
  chunksTotal: number | null
}

/** Every episode a process holds a live lease on, with what it is doing (the admin progress toast polls this). */
export async function getActiveEpisodes(now: Date = new Date()): Promise<ActiveEpisode[]> {
  const rows = await prisma.podcast.findMany({
    where: { leaseUntil: { gt: now } },
    select: { id: true, title: true, stage: true, mode: true, kind: true, dialogue: true },
    orderBy: { createdAt: 'desc' },
  })
  return Promise.all(rows.map(async row => {
    const voicing = row.stage === PodcastStage.scripted && row.dialogue != null
    return {
      id: row.id,
      title: row.title,
      stage: row.stage,
      mode: row.mode,
      activity: episodeActivity({ stage: row.stage, inProgress: true }),
      chunksDone: voicing ? await prisma.podcastAudioChunk.count({ where: { podcastId: row.id } }) : null,
      chunksTotal: voicing ? episodeChunks(row).length : null,
    }
  }))
}

/**
 * Delete an episode unless it was published or is in progress. Its voiced chunks go with it; its
 * spend ledger rows stay (the monthly cap still counts them). Deleting an unpublished weekly
 * episode frees its week key, so the week's next run makes a new one. False when there is no such episode.
 */
export async function deletePodcast(id: string): Promise<boolean> {
  const episode = await prisma.podcast.findUnique({ where: { id } })
  if (!episode) return false
  assertChangeable(episode, 'deleted')
  await prisma.podcast.delete({ where: { id } })
  await deleteEpisodeObjects(episode)
  return true
}
