/**
 * The generate_podcast cron entry (ADR-0013). It fires at several Friday slots; inside the UTC
 * Friday window (`fridayWindow` in podcastWeekSlot.ts, which the admin slot notice reads too) it
 * runs this week's episode automated (podcastWeekly.ts holds the retry, attempt
 * cap and block policy, and sends the ready notice). A block throws, so the scheduler records one
 * job-failure notice; later slots skip the blocked episode quietly, and the notice stays unseen
 * until the owner opens it. An episode a person runs interactively is left alone, and on Friday
 * evening the owner gets one reminder that it is waiting for him. generate_uplifting_podcast runs
 * the same for Actually Uplifting, and is a logged no-op while that show is closed (closing it is
 * deliberate, so no failure notice every week).
 */
import type { PodcastEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { editionClosedReason, episodeNoticeTitle } from '../services/podcastEdition.js'
import { runWeeklyEpisode } from '../services/podcastWeekly.js'
import { fridayWindow } from '../services/podcastWeekSlot.js'

const log = createLogger('generate_podcast')

/**
 * Remind the owner that this week's interactive episode is waiting for him: once per episode (one
 * per ISO week), whichever slot or process gets there first. The conditional UPDATE is the claim,
 * so a notice is never sent twice; one whose post fails is not retried (at most once). While a
 * person's run holds the lease there is no reminder: the person is at work on it.
 */
async function remindWaitingEpisode(id: string, now: Date): Promise<void> {
  const episode = await prisma.podcast.findUnique({
    where: { id },
    select: { title: true, stage: true, blockedReason: true, leaseUntil: true, edition: true },
  })
  if (!episode || (episode.leaseUntil && episode.leaseUntil > now)) return
  // Raw SQL: the column is newer than the generated client may be (see .context/podcast.md).
  const claimed = await prisma.$executeRaw`
    UPDATE "podcasts" SET "review_reminder_sent_at" = ${now}
    WHERE "id" = ${id} AND "review_reminder_sent_at" IS NULL`
  if (claimed === 0) return
  const lines = [
    `${episode.title} is at "${episode.stage}" in interactive mode; the weekly automatic run leaves it to you.`,
    ...(episode.blockedReason ? [`Blocked: ${episode.blockedReason}`] : []),
  ]
  await notify({
    source: 'podcast',
    severity: 'info',
    title: episodeNoticeTitle(episode.edition, 'waiting for you'),
    message: lines.join('\n'),
    link: `/admin/podcasts/${id}`,
  })
  log.info({ podcastId: id }, 'sent the waiting-episode reminder')
}

/** One slot of the show's weekly cron (`full` is generate_podcast, `uplifting` generate_uplifting_podcast). */
export async function runGeneratePodcast(now: Date = new Date(), edition: PodcastEdition = 'full'): Promise<void> {
  const closed = editionClosedReason(edition)
  if (closed) {
    log.info({ edition, reason: closed }, 'the show is closed, nothing to do')
    return
  }
  if (fridayWindow(now) !== 'open') {
    log.info({ edition }, 'outside the Friday window, nothing to do')
    return
  }
  const result = await runWeeklyEpisode({ trigger: 'cron', now, edition })
  if (result.outcome === 'blocked') throw new Error(`podcast episode ${result.podcastId} blocked: ${result.reason ?? 'unknown reason'}`)
  if (result.waitingForPerson && result.podcastId && now.getUTCHours() >= config.podcast.reminderFromHourUtc) {
    await remindWaitingEpisode(result.podcastId, now)
  }
}

export const runGenerateUpliftingPodcast = (now: Date = new Date()) => runGeneratePodcast(now, 'uplifting')
