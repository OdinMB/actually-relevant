/**
 * Moving episodes in and out of the feed (ADR-0006): publish, unpublish, the published episodes the
 * feed and the public JSON list, and the automatic publish job's candidate. `status = published`
 * means listed; only this module changes it. Publishing needs a `ready`, non-dry-run episode; the
 * first publication date is kept for good (the episode is never regenerated or deleted after it);
 * unpublishing always works, deletes nothing on the CDN and is never undone by the automatic job.
 */
import { ContentStatus, PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { PodcastRefusedError } from './podcastGuards.js'
import { withEpisodeLease } from './podcastPipeline.js'
import { invalidateFeedCache } from './podcastFeed.js'
import { episodeSnapshots } from './podcastScript.js'
import { isoWeekKey } from './podcastWeekly.js'
import type { PublishedEpisode } from './podcastShow.js'

const log = createLogger('podcast-publish')

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

/** Why an episode cannot be published, or null when it can. */
export function publishRefusal(episode: Pick<Podcast, 'stage' | 'dryRun' | 'audioUrl' | 'audioBytes'>): string | null {
  if (episode.stage !== PodcastStage.ready) return `only a ready episode can be published; this one is at ${episode.stage}`
  if (episode.dryRun) return 'a dry-run episode (silent stub voice) cannot be published'
  if (!episode.audioUrl || episode.audioBytes == null) return 'the episode has no uploaded audio'
  return null
}

/**
 * List the episode in the feed and on /podcast. Taken under the episode's lease, so it cannot race
 * a rewind. Sets `publishedAt` the first time only and clears a previous takedown.
 */
export async function publishEpisode(id: string, now: Date = new Date()): Promise<void> {
  await withEpisodeLease(id, async ({ episode, update }) => {
    const refusal = publishRefusal(episode)
    if (refusal) throw new PodcastRefusedError(refusal)
    await update({ status: ContentStatus.published, publishedAt: episode.publishedAt ?? now, unpublishedAt: null })
  }, 'published')
  invalidateFeedCache()
  log.info({ podcastId: id }, 'podcast episode published')
}

/**
 * Take the episode out of the feed and off /podcast. Always works (no lease, no stage check); the
 * MP3 and VTT stay on the CDN under their URLs, and a CDN purge is a manual step (owner decision).
 * False when there is no such episode.
 */
export async function unpublishEpisode(id: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.podcast.updateMany({
    where: { id, status: ContentStatus.published },
    data: { status: ContentStatus.draft, unpublishedAt: now },
  })
  if (count === 0 && !(await prisma.podcast.findUnique({ where: { id }, select: { id: true } }))) return false
  invalidateFeedCache()
  log.info({ podcastId: id }, 'podcast episode unpublished')
  return true
}

/** Published, ready, non-dry-run episodes with their audio, newest first: the feed's and the public page's list. */
export async function getPublishedEpisodes(): Promise<PublishedEpisode[]> {
  const rows = await prisma.podcast.findMany({
    where: {
      status: ContentStatus.published,
      stage: PodcastStage.ready,
      dryRun: false,
      publishedAt: { not: null },
      audioUrl: { not: null },
      audioBytes: { not: null },
    },
    select: {
      id: true, title: true, episodeSummary: true, episodeStories: true, humanEdited: true,
      audioUrl: true, audioBytes: true, durationSec: true, transcriptUrl: true, publishedAt: true,
    },
    orderBy: { publishedAt: 'desc' },
  })
  return rows.flatMap(row => {
    // The where clause guarantees these; the check narrows the types.
    if (!row.audioUrl || row.audioBytes == null || !row.publishedAt) return []
    return [{
      id: row.id,
      title: row.title,
      summary: row.episodeSummary,
      stories: Array.isArray(row.episodeStories) ? episodeSnapshots(row) : [],
      humanEdited: row.humanEdited,
      audioUrl: row.audioUrl,
      audioBytes: row.audioBytes,
      durationSec: row.durationSec,
      transcriptUrl: row.transcriptUrl,
      publishedAt: row.publishedAt,
    }]
  })
}

/**
 * The episode the automatic publish job may publish: the newest `ready`, non-dry-run episode of the
 * current or the previous ISO week that was never published or taken down, and that has been ready
 * for at least `autoPublishMinAgeHours`, so the owner had a day to listen. Null when there is none.
 */
export async function pickAutoPublishCandidate(now: Date = new Date()): Promise<Pick<Podcast, 'id' | 'title' | 'weekKey'> | null> {
  const readyBefore = new Date(now.getTime() - config.podcast.autoPublishMinAgeHours * HOUR_MS)
  return prisma.podcast.findFirst({
    where: {
      stage: PodcastStage.ready,
      dryRun: false,
      status: { not: ContentStatus.published },
      publishedAt: null,
      unpublishedAt: null,
      readyAt: { lte: readyBefore },
      weekKey: { in: [isoWeekKey(now), isoWeekKey(new Date(now.getTime() - WEEK_MS))] },
    },
    select: { id: true, title: true, weekKey: true },
    orderBy: { readyAt: 'desc' },
  })
}
