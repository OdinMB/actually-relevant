/**
 * The podcast stage machine and its lease. `advanceEpisode` claims a cross-process lease on the
 * row (database clock), runs each remaining stage and persists its output before the next starts.
 * Every stage write is fenced on the lease owner, so a process that lost its lease after a pause
 * cannot overwrite the new owner's work. A failure keeps the stage and records the error; the
 * next run resumes from the stage. Stages: `created → scripted → voiced → ready`; the audio stages
 * live in `podcastAudioStages.ts` and receive the fenced operations they need.
 */
import { randomUUID } from 'crypto'
import { Prisma, PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { assembleSpokenSegments, renderScript } from './podcastDialogue.js'
import { buildShowNotes, selectEpisodeStories, writeEpisodeScript } from './podcastScript.js'
import { deleteEpisodeObjects, finishEpisode, voiceEpisode, type AudioStageContext, type VoicedChunk } from './podcastAudioStages.js'
import { PodcastRefusedError, PodcastStoppedError, wasPublished } from './podcastGuards.js'

const log = createLogger('podcast-pipeline')

/** This process's lease id. */
const PROCESS_ID = randomUUID()
const MAX_ERROR_CHARS = 2000

export type AdvanceTrigger = 'cron' | 'admin'

export interface AdvanceOptions {
  trigger: AdvanceTrigger
  now?: Date
}

export type AdvanceResult = { status: 'busy' } | { status: 'done'; stage: PodcastStage }

/** This process no longer holds the episode's lease; another process owns its stage now. */
export class LeaseLostError extends Error {
  constructor(id: string) {
    super(`lost the lease on podcast ${id}`)
    this.name = 'LeaseLostError'
  }
}

// ---------------------------------------------------------------------------
// Lease (private to the stage machine)
// ---------------------------------------------------------------------------

async function claimLease(id: string): Promise<boolean> {
  const claimed = await prisma.$executeRaw`
    UPDATE "podcasts"
    SET "lease_owner" = ${PROCESS_ID},
        "lease_until" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${config.podcast.leaseMinutes}::int)
    WHERE "id" = ${id} AND ("lease_until" IS NULL OR "lease_until" < (now() AT TIME ZONE 'UTC'))`
  return claimed > 0
}

async function renewLease(id: string): Promise<void> {
  const renewed = await prisma.$executeRaw`
    UPDATE "podcasts"
    SET "lease_until" = (now() AT TIME ZONE 'UTC') + make_interval(mins => ${config.podcast.leaseMinutes}::int)
    WHERE "id" = ${id} AND "lease_owner" = ${PROCESS_ID}`
  if (renewed === 0) throw new LeaseLostError(id)
}

async function fencedUpdate(id: string, data: Prisma.PodcastUpdateManyMutationInput): Promise<void> {
  const { count } = await prisma.podcast.updateMany({ where: { id, leaseOwner: PROCESS_ID }, data })
  if (count === 0) throw new LeaseLostError(id)
}

/** Insert a voiced chunk only while this process holds the lease; the row lock orders it against a takeover. */
async function storeChunkFenced(id: string, chunk: VoicedChunk): Promise<void> {
  await prisma.$transaction(async tx => {
    const held = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "podcasts" WHERE "id" = ${id} AND "lease_owner" = ${PROCESS_ID} FOR UPDATE`
    if (held.length === 0) throw new LeaseLostError(id)
    await tx.podcastAudioChunk.create({
      data: { podcastId: id, index: chunk.index, bytes: new Uint8Array(chunk.bytes), requestId: chunk.requestId, chars: chunk.chars, durationMs: chunk.durationMs },
    })
  })
}

async function releaseLease(id: string): Promise<void> {
  await prisma.podcast.updateMany({ where: { id, leaseOwner: PROCESS_ID }, data: { leaseOwner: null, leaseUntil: null } })
}

/** Clear every lease this process holds (graceful shutdown), so the next process can resume at once. */
export async function releaseHeldLeases(): Promise<number> {
  const { count } = await prisma.podcast.updateMany({ where: { leaseOwner: PROCESS_ID }, data: { leaseOwner: null, leaseUntil: null } })
  return count
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

type StageWrite = Prisma.PodcastUpdateManyMutationInput & { stage: PodcastStage }
type StageRunner = (episode: Podcast, opts: AdvanceOptions, ctx: AudioStageContext) => Promise<StageWrite>

/** created → scripted: select the stories, write and validate the dialogue, freeze the snapshot. */
async function writeScriptStage(episode: Podcast, opts: AdvanceOptions): Promise<StageWrite> {
  const stories = await selectEpisodeStories(opts.now ?? new Date())
  await renewLease(episode.id)
  const { dialogue, modelId } = await writeEpisodeScript(stories)
  const snapshots = stories.map(s => s.snapshot)
  return {
    stage: PodcastStage.scripted,
    title: dialogue.episodeTitle,
    episodeSummary: dialogue.episodeSummary,
    showNotes: buildShowNotes(dialogue.episodeSummary, snapshots),
    script: renderScript(assembleSpokenSegments(dialogue)),
    dialogue,
    episodeStories: snapshots,
    storyIds: snapshots.map(s => s.id),
    scriptModelId: modelId,
  }
}

/** The work that moves an episode out of each stage; a stage without a runner is where it rests. */
const STAGE_RUNNERS: Partial<Record<PodcastStage, StageRunner>> = {
  [PodcastStage.created]: writeScriptStage,
  [PodcastStage.scripted]: (episode, _opts, ctx) => voiceEpisode(episode, ctx),
  [PodcastStage.voiced]: (episode, _opts, ctx) => finishEpisode(episode, ctx),
}

/** Errors that end a run without being a failure of the episode: nothing to record. */
const isQuietStop = (err: unknown) => err instanceof LeaseLostError || err instanceof PodcastStoppedError

async function recordFailure(id: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_CHARS)
  try {
    await fencedUpdate(id, { lastError: message, failedAt: new Date() })
  } catch (writeErr) {
    log.warn({ err: writeErr, podcastId: id }, 'could not record the podcast failure')
  }
}

/** Run every remaining stage of the episode. `busy` when another process holds its lease. */
export async function advanceEpisode(id: string, opts: AdvanceOptions): Promise<AdvanceResult> {
  if (!(await claimLease(id))) return { status: 'busy' }
  const ctx: AudioStageContext = {
    trigger: opts.trigger,
    renewLease: () => renewLease(id),
    storeChunk: chunk => storeChunkFenced(id, chunk),
  }
  try {
    let episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    if (episode.stage === PodcastStage.legacy) throw new Error('a legacy episode cannot be advanced')
    for (let run = STAGE_RUNNERS[episode.stage]; run; run = STAGE_RUNNERS[episode.stage]) {
      await renewLease(id)
      const write = await run(episode, opts, ctx)
      await fencedUpdate(id, { ...write, lastError: null, failedAt: null })
      log.info({ podcastId: id, stage: write.stage, trigger: opts.trigger }, 'podcast stage written')
      // `ready` holds the uploaded MP3; the voiced chunks have served their purpose.
      if (write.stage === PodcastStage.ready) await prisma.podcastAudioChunk.deleteMany({ where: { podcastId: id } })
      episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    }
    return { status: 'done', stage: episode.stage }
  } catch (err) {
    if (!isQuietStop(err)) await recordFailure(id, err)
    throw err
  } finally {
    await releaseLease(id).catch(err => log.warn({ err, podcastId: id }, 'could not release the podcast lease'))
  }
}

/**
 * Back to `created` with the script, voiced chunks and audio cleared, so the next advance writes a
 * new episode. Refuses an episode in progress or published; the previous objects are deleted
 * best-effort (a new render always gets a new file name, so nothing depends on it).
 */
export async function resetEpisode(id: string, opts: { dryRun: boolean }): Promise<void> {
  if (!(await claimLease(id))) throw new PodcastRefusedError('the episode is in progress and cannot be regenerated')
  let previous: Podcast | null = null
  try {
    const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    if (episode.stage === PodcastStage.legacy) throw new PodcastRefusedError('a legacy episode cannot be regenerated')
    if (wasPublished(episode)) throw new PodcastRefusedError('a published episode cannot be regenerated')
    await prisma.podcastAudioChunk.deleteMany({ where: { podcastId: id } })
    await fencedUpdate(id, {
      stage: PodcastStage.created,
      dryRun: opts.dryRun,
      script: '',
      dialogue: Prisma.DbNull,
      episodeStories: Prisma.DbNull,
      episodeSummary: '',
      showNotes: '',
      storyIds: [],
      scriptModelId: null,
      ttsModelId: null,
      voiceIds: Prisma.DbNull,
      audioUrl: null,
      audioPath: null,
      transcriptUrl: null,
      transcriptPath: null,
      audioBytes: null,
      durationSec: null,
      readyAt: null,
      lastError: null,
      failedAt: null,
    })
    previous = episode
  } finally {
    await releaseLease(id).catch(err => log.warn({ err, podcastId: id }, 'could not release the podcast lease'))
  }
  await deleteEpisodeObjects(previous)
}
