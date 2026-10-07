/**
 * Whether the podcast may spend or change an episode now: the configuration check, the monthly TTS
 * spend reservation, the ElevenLabs balance pre-check, the job-row re-check for the automatic
 * path, and the guard against changing an episode that is in progress or was published. Used by
 * the pipeline, the weekly run, CRUD and the admin routes, so the checks are never scattered.
 */
import { ContentStatus, PodcastStage, type Podcast, type PodcastKind } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { ElevenLabsQuotaError, getRemainingCharacters, isElevenLabsConfigured } from '../lib/elevenlabs.js'
import { PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED, PODCAST_STANDALONE_COPY_CONFIRMED } from '../lib/aiLabelCopy.js'

/** A failure that retrying will not fix: the episode is blocked until an admin Resume. */
export class PodcastBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PodcastBlockedError'
  }
}

/** The automatic run's job row was disabled: stop quietly, keep the stage and the voiced chunks. */
export class PodcastStoppedError extends Error {
  constructor(jobName: string) {
    super(`the ${jobName} job was disabled; stopped before the next TTS call`)
    this.name = 'PodcastStoppedError'
  }
}

/** An admin change the episode's state does not allow (in progress, or published). Maps to 409. */
export class PodcastRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PodcastRefusedError'
  }
}

/** Arbitrary constant key of the transaction-level advisory lock that serialises reservations. */
const TTS_RESERVATION_LOCK = 7_303_101

export interface RunnableContext {
  /** A dry run voices with the silent stub, so it needs no ElevenLabs key. */
  dryRun: boolean
}

/**
 * Names every missing setting the run needs; a missing setting is a block, not a retry. An alert
 * channel (WEBHOOK_URL) is not among them: without one, a block shows on the admin pages only.
 */
export function assertPodcastRunnable(ctx: RunnableContext): void {
  const missing: string[] = []
  if (!config.podcast.voiceIdA) missing.push('config.podcast.voiceIdA')
  if (!config.podcast.voiceIdB) missing.push('config.podcast.voiceIdB')
  if (!ctx.dryRun) {
    if (!isElevenLabsConfigured()) missing.push('ELEVENLABS_API_KEY')
    if (!config.bunny.storageZone) missing.push('BUNNY_STORAGE_ZONE')
    if (!config.bunny.storagePassword) missing.push('BUNNY_STORAGE_PASSWORD')
  }
  if (missing.length > 0) throw new PodcastBlockedError(`podcast configuration missing: ${missing.join(', ')}`)
}

/** Re-read the job row's `enabled` flag; a disabled or missing row stops the automatic run. */
export async function assertJobEnabled(jobName: string): Promise<void> {
  const row = await prisma.jobRun.findUnique({ where: { jobName }, select: { enabled: true } })
  if (!row?.enabled) throw new PodcastStoppedError(jobName)
}

/** Start of the UTC calendar month of `now`. */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** TTS characters reserved this UTC calendar month, deleted episodes included. */
export async function monthToDateChars(now: Date = new Date()): Promise<number> {
  const { _sum } = await prisma.podcastTtsUsage.aggregate({ _sum: { chars: true }, where: { createdAt: { gte: utcMonthStart(now) } } })
  return _sum.chars ?? 0
}

/** TTS characters reserved for one episode, every re-voice included. */
export async function episodeTtsChars(podcastId: string): Promise<number> {
  const { _sum } = await prisma.podcastTtsUsage.aggregate({ _sum: { chars: true }, where: { podcastId } })
  return _sum.chars ?? 0
}

/**
 * Reserve a TTS call's characters against the monthly cap before the call is made. The advisory
 * lock, taken first in the transaction, serialises concurrent reservations so two calls near the
 * cap cannot both pass. The row stays whatever the call's outcome: a timed-out call may be billed.
 */
export async function reserveTtsChars(podcastId: string, chars: number, now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TTS_RESERVATION_LOCK}::bigint)`
    const { _sum } = await tx.podcastTtsUsage.aggregate({ _sum: { chars: true }, where: { createdAt: { gte: utcMonthStart(now) } } })
    const used = _sum.chars ?? 0
    if (used + chars > config.podcast.monthlyTtsCharCap) {
      throw new PodcastBlockedError(`monthly TTS cap reached: ${used} of ${config.podcast.monthlyTtsCharCap} characters used this month, this call needs ${chars}`)
    }
    await tx.podcastTtsUsage.create({ data: { podcastId, chars } })
  })
}

/** The ElevenLabs balance must cover the characters still to voice (a coarse guard: it lags a few calls). */
export async function assertBalanceCovers(chars: number): Promise<void> {
  const remaining = await getRemainingCharacters().catch(err => {
    // A key without "user read", or an account refusal, will not fix itself on a retry.
    throw err instanceof ElevenLabsQuotaError ? new PodcastBlockedError(err.message) : err
  })
  if (remaining < chars) {
    throw new PodcastBlockedError(`ElevenLabs credits too low: ${remaining} left, ${chars} needed for the remaining chunks`)
  }
}

/**
 * Ever published: a non-legacy row with a first publication date (or, for a row the publish
 * migration did not backfill, a published status). Unpublishing does not undo it.
 */
export function wasPublished(episode: Pick<Podcast, 'stage' | 'status' | 'publishedAt'>): boolean {
  if (episode.stage === PodcastStage.legacy) return false
  return episode.publishedAt != null || episode.status === ContentStatus.published
}

/**
 * Why an episode with this "Edited by a person" flag may not be listed, or null when it may: the
 * edited AI line goes public only once the owner has confirmed its wording. Publishing such an
 * episode, and ticking the flag on a listed one, are refused until then. Confirmed on 2026-10-06;
 * the guard stays so that an unconfirmed wording change can set the flag back to false.
 */
export function editedAiLineRefusal(humanEdited: boolean, confirmed: boolean = PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED): string | null {
  if (!humanEdited || confirmed) return null
  return 'an episode marked "Edited by a person" cannot be listed yet: its AI line awaits the owner\'s confirmation (PODCAST_EPISODE_AI_LINE_EDITED_CONFIRMED in server/src/lib/aiLabelCopy.ts)'
}

/**
 * Why an episode of this kind may not be voiced live or listed, or null when it may: a standalone
 * episode's opener and AI line go out only once the owner has confirmed their wording
 * (`PODCAST_STANDALONE_COPY_CONFIRMED`). A weekly episode is never refused here. Confirmed on
 * 2026-10-07; the guard stays so that an unconfirmed wording change can set the flag back to false.
 */
export function standaloneCopyRefusal(kind: PodcastKind, confirmed: boolean = PODCAST_STANDALONE_COPY_CONFIRMED): string | null {
  if (kind !== 'standalone' || confirmed) return null
  return "a standalone episode cannot be voiced live or listed yet: its opener and AI line await the owner's confirmation (PODCAST_STANDALONE_COPY_CONFIRMED in server/src/lib/aiLabelCopy.ts)"
}

/**
 * An episode that was published keeps its audio and GUID for good, and one a process is working
 * on must not change underneath it.
 */
export function assertChangeable(episode: Pick<Podcast, 'stage' | 'status' | 'publishedAt' | 'leaseUntil'>, action: string, now: Date = new Date()): void {
  if (wasPublished(episode)) throw new PodcastRefusedError(`a published episode cannot be ${action}`)
  if (episode.leaseUntil && episode.leaseUntil > now) throw new PodcastRefusedError(`the episode is in progress and cannot be ${action}`)
}
