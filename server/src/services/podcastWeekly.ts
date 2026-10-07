/**
 * "This week's episode", the runs that advance an episode, and their retry and block policy. The
 * admin "Start this week's episode" only finds or creates the row; a person then starts it in a
 * mode, and `startAdminRun` + `resumeEpisode` run it under the lease the route claimed. The
 * generate_podcast job calls `runWeeklyEpisode({ trigger: 'cron' })`, which runs automated and
 * leaves an interactive episode to the person reviewing it. Only automatic runs count attempts;
 * an admin action clears a block.
 */
import { ContentStatus, PodcastStage, type Podcast, type PodcastMode } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notifyEvent } from '../lib/notify.js'
import {
  advanceEpisode, claimEpisode, defaultEpisodeTitle, releaseEpisode, rewindEpisode, LeaseLostError,
  type AdvanceTrigger, type RewindTarget,
} from './podcastPipeline.js'
import { assertPodcastRunnable, episodeTtsChars, monthToDateChars, PodcastBlockedError, PodcastRefusedError, PodcastStoppedError } from './podcastGuards.js'

const log = createLogger('podcast-weekly')
const DAY_MS = 24 * 60 * 60 * 1000

/** `stopped`: the automatic run's job row was disabled mid-run; no attempt counted, no alert. */
export type WeeklyOutcome = 'done' | 'skipped' | 'stopped' | 'retry-later' | 'blocked'

export interface WeeklyResult {
  outcome: WeeklyOutcome
  podcastId: string
  reason?: string
  /** Skipped because a person runs the episode interactively: it waits for them, not for the job. */
  waitingForPerson?: true
  /** Skipped on the cron trigger because an earlier run blocked the episode: the block's reason. */
  stillBlocked?: string
}

/**
 * ISO week of `date` in UTC (`YYYY-Www`). Not the newsletter job's `getWeekKey`, which reads the
 * server's local calendar day: the podcast's Friday window is defined in UTC.
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
      data: { title: defaultEpisodeTitle({ weekKey, createdAt: now }), weekKey, stage: PodcastStage.created, dryRun: config.podcast.dryRun },
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

const minutesSeconds = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

/**
 * The success notice when an episode reaches `ready`: a missing Friday message is itself a
 * signal. A notice that cannot be built is logged; it never fails the run.
 */
async function announceReady(id: string, now: Date): Promise<void> {
  try {
    const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    const [episodeChars, monthChars] = await Promise.all([episodeTtsChars(id), monthToDateChars(now)])
    const lines = [
      `${episode.title}${episode.dryRun ? ' (dry run, silent stub voice)' : ''}`,
      `Duration ${minutesSeconds(episode.durationSec ?? 0)}; TTS characters this episode ${episodeChars}, this month ${monthChars} of ${config.podcast.monthlyTtsCharCap}.`,
      `Listen and publish: ${config.clientUrl}/admin/podcasts/${id}`,
    ]
    await notifyEvent('Podcast episode ready', lines.join('\n'))
  } catch (err) {
    log.warn({ err, podcastId: id }, 'could not send the podcast ready notice')
  }
}

/**
 * A row made in a dry run, now run live: back to `created`, discarding the stub's work. A standalone
 * row goes back only to `selected`, keeping the stories a person chose (at `selected` already, only
 * the flag changes).
 */
async function leaveDryRun(episode: Podcast, leaseHeld: boolean): Promise<void> {
  const keepStories = episode.kind === 'standalone' && episode.stage !== PodcastStage.created
  if (keepStories && episode.stage === PodcastStage.selected) {
    await prisma.podcast.update({ where: { id: episode.id }, data: { dryRun: false } })
    return
  }
  await rewindEpisode(episode.id, keepStories ? 'selected' : 'created', { dryRun: false, leaseHeld })
}

interface RunOptions {
  trigger: AdvanceTrigger
  now: Date
  /** The admin route claimed the lease before its 202; the run uses it instead of claiming. */
  leaseHeld: boolean
}

async function runEpisode(episode: Podcast, { trigger, now, leaseHeld }: RunOptions): Promise<WeeklyResult> {
  const id = episode.id
  const result = (outcome: WeeklyOutcome, reason?: string): WeeklyResult => {
    log.info({ podcastId: id, trigger, outcome, reason }, 'podcast weekly run')
    return { outcome, podcastId: id, ...(reason ? { reason } : {}) }
  }

  if (episode.status === ContentStatus.published || episode.stage === PodcastStage.ready) return result('skipped', 'already finished')
  // The job never overrides a person mid-review, blocked or not: the episode waits for them.
  if (trigger === 'cron' && episode.mode === 'interactive') {
    return { ...result('skipped', 'interactive: the owner is reviewing it'), waitingForPerson: true }
  }
  if (episode.blockedAt) {
    if (trigger === 'cron') return { ...result('skipped', 'blocked'), stillBlocked: episode.blockedReason ?? 'unknown reason' }
    await clearBlock(id)
  } else if (trigger === 'admin' && episode.attempts > 0) {
    await clearBlock(id)
  }
  // An episode nobody started runs automated on the cron trigger.
  if (trigger === 'cron' && episode.mode === null) await prisma.podcast.update({ where: { id }, data: { mode: 'automated' } })

  try {
    assertPodcastRunnable({ dryRun: config.podcast.dryRun })
    if (episode.dryRun && !config.podcast.dryRun) await leaveDryRun(episode, leaseHeld)
    const advanced = await advanceEpisode(id, { trigger, leaseHeld })
    if (advanced.status === 'busy') return result('skipped', 'in progress in another process')
    if (advanced.stage === PodcastStage.ready) await announceReady(id, now)
    return result('done')
  } catch (err) {
    if (err instanceof LeaseLostError) return result('skipped', 'lost the lease to another process')
    if (err instanceof PodcastStoppedError) return result('stopped', err.message)
    if (err instanceof PodcastBlockedError) {
      await block(id, err.message)
      return result('blocked', err.message)
    }
    log.error({ err, podcastId: id, trigger }, 'podcast weekly run failed')
    if (trigger === 'cron') return result(await countAutomaticFailure(id, err))
    return result('retry-later')
  }
}

/** Find or create this ISO week's episode and advance it as far as its mode lets it go. */
export async function runWeeklyEpisode(opts: { trigger: AdvanceTrigger; now?: Date }): Promise<WeeklyResult> {
  const now = opts.now ?? new Date()
  return runEpisode(await findOrCreateWeekEpisode(now), { trigger: opts.trigger, now, leaseHeld: false })
}

export interface AdminRunRequest {
  /** Store this mode first (start, or "Finish automatically"); otherwise the episode's own. */
  mode?: PodcastMode
  /** Rewind to this stage first (Start over, Regenerate script, Regenerate audio). */
  rewindTo?: RewindTarget
}

/**
 * The synchronous half of an admin start, approve, resume or rewind-and-continue (ADR-0009):
 * checks the episode can run, claims its lease, rewinds if asked, stores the mode and clears a
 * block. The caller answers 202 and then runs `resumeEpisode` with the lease this leaves held.
 * A rewind without a given mode makes the episode interactive: a person stepped in, so the run
 * stops at the next review point instead of voicing unseen. Refusals are `PodcastRefusedError` (409).
 * No run starts a standalone episode from `created`: a person chooses its stories (ADR-0015).
 */
export async function startAdminRun(id: string, req: AdminRunRequest = {}): Promise<void> {
  const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
  if (episode.stage === PodcastStage.legacy) throw new PodcastRefusedError('a legacy episode cannot be run')
  if (episode.kind === 'standalone' && (req.rewindTo ?? episode.stage) === PodcastStage.created) {
    throw new PodcastRefusedError("choose the episode's stories first")
  }
  const mode = req.mode ?? (req.rewindTo ? 'interactive' : episode.mode)
  if (!mode) throw new PodcastRefusedError('choose interactive or fully automated first')
  if (!req.rewindTo && episode.stage === PodcastStage.ready) throw new PodcastRefusedError('the episode is already ready')
  if (!(await claimEpisode(id))) throw new PodcastRefusedError('the episode is in progress')
  try {
    if (req.rewindTo) await rewindEpisode(id, req.rewindTo, { dryRun: config.podcast.dryRun, leaseHeld: true })
    await prisma.podcast.update({ where: { id }, data: { mode, blockedAt: null, blockedReason: null, attempts: 0 } })
  } catch (err) {
    await releaseEpisode(id)
    throw err
  }
}

/**
 * The background half: advance the episode under the lease `startAdminRun` claimed, and release
 * it whatever happens (an early return included).
 */
export async function resumeEpisode(id: string): Promise<WeeklyResult> {
  try {
    const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    return await runEpisode(episode, { trigger: 'admin', now: new Date(), leaseHeld: true })
  } finally {
    await releaseEpisode(id)
  }
}
