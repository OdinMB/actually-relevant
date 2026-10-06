/**
 * "This week's episode" and its retry and block policy. The admin "Start this week's episode"
 * route calls `runWeeklyEpisode({ trigger: 'admin' })`; the generate_podcast job will call it
 * with `trigger: 'cron'`. Only automatic runs count attempts; an admin action clears a block.
 */
import { ContentStatus, PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { advanceEpisode, resetEpisode, LeaseLostError, type AdvanceTrigger } from './podcastPipeline.js'
import { PodcastBlockedError } from './podcastGuards.js'

const log = createLogger('podcast-weekly')
const DAY_MS = 24 * 60 * 60 * 1000

export type WeeklyOutcome = 'done' | 'skipped' | 'retry-later' | 'blocked'

export interface WeeklyResult {
  outcome: WeeklyOutcome
  podcastId: string
  reason?: string
}

/**
 * ISO week of `date` in UTC (`YYYY-Www`). Not the newsletter job's `getWeekKey`, which reads the
 * server's local calendar day: the podcast's weekend window is defined in UTC.
 */
export function isoWeekKey(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday) // the Thursday of this ISO week decides its year
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

const isUniqueViolation = (err: unknown) => (err as { code?: unknown })?.code === 'P2002'

/** The week's row, created on first use; the unique week key makes a concurrent create harmless. */
export async function findOrCreateWeekEpisode(now: Date = new Date()): Promise<Podcast> {
  const weekKey = isoWeekKey(now)
  const existing = await prisma.podcast.findUnique({ where: { weekKey } })
  if (existing) return existing
  try {
    return await prisma.podcast.create({
      data: { title: `Actually Relevant, ${weekKey}`, weekKey, stage: PodcastStage.created, dryRun: config.podcast.dryRun },
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    return prisma.podcast.findUniqueOrThrow({ where: { weekKey } })
  }
}

async function block(id: string, reason: string): Promise<void> {
  await prisma.podcast.update({ where: { id }, data: { blockedAt: new Date(), blockedReason: reason } })
}

async function clearBlock(id: string): Promise<void> {
  await prisma.podcast.update({ where: { id }, data: { blockedAt: null, blockedReason: null, attempts: 0 } })
}

/** A cron failure: count it, and block the episode once the week's attempts are used up. */
async function countAutomaticFailure(id: string, err: unknown): Promise<WeeklyOutcome> {
  const { attempts } = await prisma.podcast.update({ where: { id }, data: { attempts: { increment: 1 } } })
  if (attempts < config.podcast.maxAttemptsPerWeek) return 'retry-later'
  const message = err instanceof Error ? err.message : String(err)
  await block(id, `${attempts} automatic attempts failed this week; last error: ${message}`)
  return 'blocked'
}

async function runEpisode(episode: Podcast, trigger: AdvanceTrigger, now: Date): Promise<WeeklyResult> {
  const id = episode.id
  const result = (outcome: WeeklyOutcome, reason?: string): WeeklyResult => {
    log.info({ podcastId: id, trigger, outcome, reason }, 'podcast weekly run')
    return { outcome, podcastId: id, ...(reason ? { reason } : {}) }
  }

  if (episode.status === ContentStatus.published || episode.stage === PodcastStage.ready) return result('skipped', 'already finished')
  if (episode.blockedAt) {
    if (trigger === 'cron') return result('skipped', 'blocked')
    await clearBlock(id)
  } else if (trigger === 'admin' && episode.attempts > 0) {
    await clearBlock(id)
  }

  try {
    if (episode.dryRun && !config.podcast.dryRun) await resetEpisode(id, { dryRun: false })
    const advanced = await advanceEpisode(id, { trigger, now })
    if (advanced.status === 'busy') return result('skipped', 'in progress in another process')
    return result('done')
  } catch (err) {
    if (err instanceof LeaseLostError) return result('skipped', 'lost the lease to another process')
    if (err instanceof PodcastBlockedError) {
      await block(id, err.message)
      return result('blocked', err.message)
    }
    log.error({ err, podcastId: id, trigger }, 'podcast weekly run failed')
    if (trigger === 'cron') return result(await countAutomaticFailure(id, err))
    return result('retry-later')
  }
}

/** Find or create this ISO week's episode and advance it as far as it goes. */
export async function runWeeklyEpisode(opts: { trigger: AdvanceTrigger; now?: Date }): Promise<WeeklyResult> {
  const now = opts.now ?? new Date()
  return runEpisode(await findOrCreateWeekEpisode(now), opts.trigger, now)
}

/** Admin Resume: clear a block and the week's attempts, then advance that episode. */
export async function resumeEpisode(id: string): Promise<WeeklyResult> {
  const episode = await prisma.podcast.findUnique({ where: { id } })
  if (!episode) throw new Error('Podcast not found')
  if (episode.stage === PodcastStage.legacy) throw new Error('a legacy episode cannot be resumed')
  await clearBlock(id)
  return runEpisode({ ...episode, blockedAt: null, blockedReason: null, attempts: 0 }, 'admin', new Date())
}
