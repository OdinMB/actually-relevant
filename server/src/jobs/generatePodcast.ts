/**
 * The generate_podcast cron entry (ADR-0011). It fires at several weekend slots; inside the UTC
 * weekend window it runs this week's episode automated (podcastWeekly.ts holds the retry, attempt
 * cap and block policy, and sends the ready notice). A block throws, so the scheduler alerts once;
 * later slots skip the blocked episode. An episode a person runs interactively is left alone, and
 * on Sunday the owner gets one reminder that it is waiting for him.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import { runWeeklyEpisode } from '../services/podcastWeekly.js'

const log = createLogger('generate_podcast')

const SATURDAY = 6
const SUNDAY = 0

/** Saturday from `weekendWindowStartHourUtc` through Sunday 23:59, in UTC whatever the server's zone. */
export function inWeekendWindow(now: Date): boolean {
  const day = now.getUTCDay()
  if (day === SUNDAY) return true
  return day === SATURDAY && now.getUTCHours() >= config.podcast.weekendWindowStartHourUtc
}

/**
 * Remind the owner that this week's interactive episode is waiting for him: once per episode (one
 * per ISO week), whichever slot or process gets there first. The conditional UPDATE is the claim,
 * so a notice is never sent twice; one whose post fails is not retried (at most once). While a
 * person's run holds the lease, a later slot reminds instead.
 */
async function remindWaitingEpisode(id: string, now: Date): Promise<void> {
  const episode = await prisma.podcast.findUnique({
    where: { id },
    select: { title: true, stage: true, blockedReason: true, leaseUntil: true },
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
    `Continue it: ${config.clientUrl}/admin/podcasts/${id}`,
  ]
  await notifyEvent('Podcast episode waiting for you', lines.join('\n'))
  log.info({ podcastId: id }, 'sent the waiting-episode reminder')
}

export async function runGeneratePodcast(now: Date = new Date()): Promise<void> {
  if (!inWeekendWindow(now)) {
    log.info('outside the weekend window, nothing to do')
    return
  }
  const result = await runWeeklyEpisode({ trigger: 'cron', now })
  if (result.outcome === 'blocked') throw new Error(`podcast episode ${result.podcastId} blocked: ${result.reason ?? 'unknown reason'}`)
  if (result.waitingForPerson && now.getUTCDay() === SUNDAY) await remindWaitingEpisode(result.podcastId, now)
}
