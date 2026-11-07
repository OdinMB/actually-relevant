/**
 * Moving episodes in and out of the feed (ADR-0013): publish, unpublish, the published episodes the
 * public surfaces read (feed, public JSON, an episode's transcript page, a story's page, sitemap), and
 * the automatic publish job's candidate. `status = published`
 * means listed; only this module changes it. Publishing needs a `ready`, non-dry-run episode of an
 * open show; the first publication date is kept for good (the episode is never regenerated or
 * deleted after it); unpublishing always works, deletes nothing on the CDN and is never undone by the
 * automatic job. A public surface sees a published episode only while its show is open.
 */
import { ContentStatus, PodcastStage, type Podcast, type PodcastEdition, type Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { PodcastRefusedError, editedAiLineRefusal, standaloneCopyRefusal } from './podcastGuards.js'
import { editionClosedReason, openEditions } from './podcastEdition.js'
import { withEpisodeLease } from './podcastPipeline.js'
import { invalidateFeedCache } from './podcastFeed.js'
import { episodeSnapshots } from './podcastScript.js'
import { isoWeekKey } from './podcastWeekly.js'
import type { PublishedEpisode } from './podcastShow.js'

const log = createLogger('podcast-publish')

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

type PublishFields = 'stage' | 'dryRun' | 'audioUrl' | 'audioBytes' | 'humanEdited' | 'kind' | 'edition'

/**
 * The episode page's step (its tab) where an unfinished episode's work stands, for reasons a person
 * reads: the page shows Stories, Script and Audio, never the internal stage names.
 */
const STEP_OF_STAGE: Record<Exclude<PodcastStage, 'legacy' | 'ready'>, string> = {
  created: 'Stories',
  selected: 'Script',
  scripted: 'Audio',
  voiced: 'Audio',
}

/** Why an episode that has not reached `ready` cannot be published yet, in the page's step names. */
export function unfinishedReason(stage: Exclude<PodcastStage, 'ready'>): string {
  if (stage === PodcastStage.legacy) return 'a legacy episode cannot be published'
  return `the episode is not finished; it is still at the ${STEP_OF_STAGE[stage]} step`
}

/** Why an episode cannot be published, or null when it can. */
export function publishRefusal(episode: Pick<Podcast, PublishFields>): string | null {
  if (episode.stage !== PodcastStage.ready) return unfinishedReason(episode.stage)
  if (episode.dryRun) return 'a dry-run episode (silent stub voice) cannot be published'
  if (!episode.audioUrl || episode.audioBytes == null) return 'the episode has no uploaded audio'
  return editionClosedReason(episode.edition) ?? standaloneCopyRefusal(episode.kind) ?? editedAiLineRefusal(episode.humanEdited)
}

/**
 * Why the admin cannot publish the episode right now, shown in place of the Publish button so it is
 * never missing without a reason; null when it can be published, and for a listed episode, which can
 * always be unpublished. `inProgress` is a live lease: publishing would be refused until the run ends.
 */
export function publishBlockedReason(episode: Pick<Podcast, 'status' | PublishFields>, inProgress: boolean): string | null {
  if (episode.status === ContentStatus.published) return null
  if (inProgress) return 'a run is working on the episode; publishing waits until it finishes'
  return publishRefusal(episode)
}

/**
 * List the episode in the feed and on /podcast. Taken under the episode's lease, so it cannot race
 * a rewind. Sets `publishedAt` the first time only and clears a previous takedown.
 */
export async function publishEpisode(id: string, now: Date = new Date()): Promise<void> {
  await withEpisodeLease(
    id,
    async ({ episode, update }) => {
      const refusal = publishRefusal(episode)
      if (refusal) throw new PodcastRefusedError(refusal)
      await update({ status: ContentStatus.published, publishedAt: episode.publishedAt ?? now, unpublishedAt: null })
    },
    'published',
  )
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

/**
 * What "published" means for every public surface: the feed, /podcast, an episode's transcript page, a
 * story's page, the sitemap. Read per request, so closing a show takes its episodes off them at once.
 */
export function publishedWhere(): Prisma.PodcastWhereInput {
  return {
    status: ContentStatus.published,
    stage: PodcastStage.ready,
    dryRun: false,
    publishedAt: { not: null },
    audioUrl: { not: null },
    audioBytes: { not: null },
    edition: { in: openEditions() },
  }
}

const PUBLISHED_SELECT = {
  id: true,
  title: true,
  kind: true,
  edition: true,
  episodeSummary: true,
  episodeStories: true,
  humanEdited: true,
  audioUrl: true,
  audioBytes: true,
  durationSec: true,
  transcriptUrl: true,
  chaptersUrl: true,
  publishedAt: true,
} satisfies Prisma.PodcastSelect

type PublishedRow = Prisma.PodcastGetPayload<{ select: typeof PUBLISHED_SELECT }>

function toPublishedEpisode(row: PublishedRow): PublishedEpisode | null {
  // The where clause guarantees these; the check narrows the types.
  if (!row.audioUrl || row.audioBytes == null || !row.publishedAt) return null
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    edition: row.edition,
    summary: row.episodeSummary,
    stories: Array.isArray(row.episodeStories) ? episodeSnapshots(row) : [],
    humanEdited: row.humanEdited,
    audioUrl: row.audioUrl,
    audioBytes: row.audioBytes,
    durationSec: row.durationSec,
    transcriptUrl: row.transcriptUrl,
    chaptersUrl: row.chaptersUrl,
    publishedAt: row.publishedAt,
  }
}

/** The show's published, ready, non-dry-run episodes with their audio, newest first: its feed's and its public page's list. */
export async function getPublishedEpisodes(edition: PodcastEdition): Promise<PublishedEpisode[]> {
  const rows = await prisma.podcast.findMany({
    // Narrowed beside the open-shows filter, never in its place
    where: { ...publishedWhere(), AND: [{ edition }] },
    select: PUBLISHED_SELECT,
    orderBy: { publishedAt: 'desc' },
  })
  return rows.flatMap(row => toPublishedEpisode(row) ?? [])
}

/** One published episode with its stored dialogue (for its transcript page); null when it is not published. */
export async function getPublishedEpisode(id: string): Promise<(PublishedEpisode & { dialogue: unknown }) | null> {
  const row = await prisma.podcast.findFirst({ where: { id, ...publishedWhere() }, select: { ...PUBLISHED_SELECT, dialogue: true } })
  const episode = row && toPublishedEpisode(row)
  return episode && { ...episode, dialogue: row.dialogue }
}

/** The first published episode with the story among its stories (for the story's page); null when none has it. */
export async function getFirstPublishedEpisodeWithStory(storyId: string): Promise<PublishedEpisode | null> {
  const row = await prisma.podcast.findFirst({
    where: { ...publishedWhere(), storyIds: { has: storyId } },
    select: PUBLISHED_SELECT,
    orderBy: { publishedAt: 'asc' },
  })
  return row && toPublishedEpisode(row)
}

/** A published episode's title, summary and first publication, or null: what its transcript page's link preview reads. */
export async function findPublishedEpisodeHead(id: string): Promise<{ id: string; title: string; summary: string; publishedAt: Date } | null> {
  const row = await prisma.podcast.findFirst({ where: { id, ...publishedWhere() }, select: { id: true, title: true, episodeSummary: true, publishedAt: true } })
  return row?.publishedAt ? { id: row.id, title: row.title, summary: row.episodeSummary, publishedAt: row.publishedAt } : null
}

/** The ids and first publication dates of the published episodes, newest first (the sitemap's transcript pages). */
export async function listPublishedEpisodeDates(): Promise<{ id: string; publishedAt: Date }[]> {
  const rows = await prisma.podcast.findMany({ where: publishedWhere(), select: { id: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } })
  return rows.flatMap(r => (r.publishedAt ? [{ id: r.id, publishedAt: r.publishedAt }] : []))
}

/**
 * The episode the automatic publish job may publish: the newest `ready`, non-dry-run episode of the
 * current or the previous ISO week that was never published or taken down, and that has been ready
 * for at least `autoPublishMinAgeHours`, so the owner had the evening before to listen. Only a weekly
 * episode of the given show: a standalone one is published by hand only. Null when there is none.
 */
export async function pickAutoPublishCandidate(now: Date, edition: PodcastEdition): Promise<Pick<Podcast, 'id' | 'title' | 'weekKey'> | null> {
  const readyBefore = new Date(now.getTime() - config.podcast.autoPublishMinAgeHours * HOUR_MS)
  return prisma.podcast.findFirst({
    where: {
      edition,
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
