/**
 * Moving episodes in and out of the feed (ADR-0013): publish, unpublish, the published episodes the
 * feed and the public JSON list, and the automatic publish job's candidate. `status = published`
 * means listed; only this module changes it. Publishing needs a `ready`, non-dry-run episode; the
 * first publication date is kept for good (the episode is never regenerated or deleted after it);
 * unpublishing always works, deletes nothing on the CDN and is never undone by the automatic job.
 */
import { ContentStatus, PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { PodcastRefusedError, editedAiLineRefusal, standaloneCopyRefusal } from './podcastGuards.js'
import { withEpisodeLease } from './podcastPipeline.js'
import { invalidateFeedCache } from './podcastFeed.js'
import { episodeSnapshots } from './podcastScript.js'
import { isoWeekKey } from './podcastWeekly.js'
import type { PublishedEpisode } from './podcastShow.js'

const log = createLogger('podcast-publish')

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

type PublishFields = 'stage' | 'dryRun' | 'audioUrl' | 'audioBytes' | 'humanEdited' | 'kind'

/** Why an episode cannot be published, or null when it can. */
export function publishRefusal(episode: Pick<Podcast, PublishFields>): string | null {
  if (episode.stage !== PodcastStage.ready) return `only a ready episode can be published; this one is at ${episode.stage}`
  if (episode.dryRun) return 'a dry-run episode (silent stub voice) cannot be published'
  if (!episode.audioUrl || episode.audioBytes == null) return 'the episode has no uploaded audio'
  return standaloneCopyRefusal(episode.kind) ?? editedAiLineRefusal(episode.humanEdited)
}

/**
 * Why the admin cannot publish the episode right now, shown in place of the Publish button so it is
 * never missing without a reason; null when it can be published, and for a listed episode, which can
 * always be unpublished. `inProgress` is a live lease: publishing would be refused until the run ends.
 */
export function publishBlockedReason(
  episode: Pick<Podcast, 'status' | PublishFields>,
  inProgress: boolean,
): string | null {
  if (episode.status === ContentStatus.published) return null
  if (inProgress) return 'a run is working on the episode; publishing waits until it finishes'
  return publishRefusal(episode)
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
      id: true, title: true, kind: true, episodeSummary: true, episodeStories: true, humanEdited: true,
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
      kind: row.kind,
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
 * for at least `autoPublishMinAgeHours`, so the owner had the evening before to listen. Only a weekly
 * episode: a standalone one is published by hand only. Null when there is none.
 */
export async function pickAutoPublishCandidate(now: Date = new Date()): Promise<Pick<Podcast, 'id' | 'title' | 'weekKey'> | null> {
  const readyBefore = new Date(now.getTime() - config.podcast.autoPublishMinAgeHours * HOUR_MS)
  return prisma.podcast.findFirst({
    where: {
      kind: 'weekly',
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
