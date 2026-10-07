/**
 * The podcast stage machine and its lease. `advanceEpisode` claims a cross-process lease on the
 * row (database clock), runs each remaining stage and persists its output before the next starts.
 * Every stage write is fenced on the lease owner, so a process that lost its lease after a pause
 * cannot overwrite the new owner's work. A failure keeps the stage and records the error; the
 * next run resumes from the stage. Stages: `created → selected → scripted → voiced → ready`; the
 * audio stages live in `podcastAudioStages.ts` and receive the fenced operations they need.
 *
 * An interactive episode stops after `selected` and after `scripted` for a person's review
 * (ADR-0008). No runner moves a stage backwards: going back is `rewindEpisode`, an explicit admin
 * action. The lease is exported for the admin routes and a person's edits (ADR-0009): a route
 * claims it before answering 202 and hands it to the background run, so a double click cannot
 * start two runs and the episode shows as in progress from the first answer on.
 */
import { randomInt, randomUUID } from 'crypto'
import { Prisma, type Podcast, type PodcastMode, type PodcastStage } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { assembleSpokenSegments, renderScript } from './podcastDialogue.js'
import { buildShowNotes, episodeSnapshots, loadEpisodeStories, selectEpisodeStories, writeEpisodeScript } from './podcastScript.js'
import { deleteEpisodeObjects, finishEpisode, voiceEpisode, type AudioStageContext, type VoicedChunk } from './podcastAudioStages.js'
import { PodcastRefusedError, PodcastStoppedError, wasPublished } from './podcastGuards.js'

const log = createLogger('podcast-pipeline')

/** This process's lease id. */
const PROCESS_ID = randomUUID()
const MAX_ERROR_CHARS = 2000

export type AdvanceTrigger = 'cron' | 'admin'

export interface AdvanceOptions {
  trigger: AdvanceTrigger
  /** The caller already holds the lease (an admin route claimed it before its 202); it is released here all the same. */
  leaseHeld?: boolean
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
// Lease
// ---------------------------------------------------------------------------

/** Take the episode's lease for this process; false while another holder's lease is live. */
export async function claimEpisode(id: string): Promise<boolean> {
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

/** Give up this process's lease on the episode (never another holder's). A failure is logged: the lease expires anyway. */
export async function releaseEpisode(id: string): Promise<void> {
  try {
    await prisma.podcast.updateMany({ where: { id, leaseOwner: PROCESS_ID }, data: { leaseOwner: null, leaseUntil: null } })
  } catch (err) {
    log.warn({ err, podcastId: id }, 'could not release the podcast lease')
  }
}

/** Clear every lease this process holds (graceful shutdown), so the next process can resume at once. */
export async function releaseHeldLeases(): Promise<number> {
  const { count } = await prisma.podcast.updateMany({ where: { leaseOwner: PROCESS_ID }, data: { leaseOwner: null, leaseUntil: null } })
  return count
}

export interface HeldEpisode {
  /** The episode as read after the lease was taken. */
  episode: Podcast
  /** A write fenced on this process's lease. */
  update(data: Prisma.PodcastUpdateManyMutationInput): Promise<void>
}

/**
 * Take the lease, run `fn` on the episode as read under it, and release. A person's edit uses this,
 * so it can never race a run; refused (409) while a run holds the episode.
 */
export async function withEpisodeLease<T>(id: string, fn: (held: HeldEpisode) => Promise<T>, action = 'changed'): Promise<T> {
  if (!(await claimEpisode(id))) throw new PodcastRefusedError(`the episode is in progress and cannot be ${action}`)
  try {
    const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    return await fn({ episode, update: data => fencedUpdate(id, data) })
  } finally {
    await releaseEpisode(id)
  }
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** Production order; `legacy` rows are outside it. */
const STAGE_ORDER: PodcastStage[] = ['created', 'selected', 'scripted', 'voiced', 'ready']
const stageIndex = (stage: PodcastStage) => STAGE_ORDER.indexOf(stage)

/** Where an interactive episode waits for a person after the stage is written. */
const REVIEW_STOPS = new Set<PodcastStage>(['selected', 'scripted'])

/** Whether a run stops at the episode's stage for a person's review (interactive mode only). */
export function pausesForReview(episode: Pick<Podcast, 'mode' | 'stage'>): boolean {
  return episode.mode === 'interactive' && REVIEW_STOPS.has(episode.stage)
}

/**
 * The title a row starts with, and returns to when its script is discarded: the week key for a
 * weekly row, the UTC creation date for a standalone one (so several are told apart).
 */
export function defaultEpisodeTitle(row: Pick<Podcast, 'weekKey' | 'createdAt'>): string {
  return `Actually Relevant, ${row.weekKey ?? row.createdAt.toISOString().slice(0, 10)}`
}

/** "W41" for the ISO week key "2026-W41"; none without a week key. */
const weekLabel = (weekKey: string | null): string | null => weekKey?.split('-')[1] ?? null

type StageWrite = Prisma.PodcastUpdateManyMutationInput & { stage: PodcastStage }
type StageRunner = (episode: Podcast, ctx: AudioStageContext) => Promise<StageWrite>

/**
 * created → selected: the model picks the stories from the week's pool as of now; the snapshot
 * freezes them, and `storiesSelectedAt` keeps the pool's anchor so the story picker lists the
 * same pool the model chose from. A standalone episode's stories are chosen by a person
 * (ADR-0015); `startAdminRun` already refuses to run one from `created`, and this is the backstop.
 */
async function selectStage(episode: Podcast): Promise<StageWrite> {
  if (episode.kind === 'standalone') throw new PodcastRefusedError("a standalone episode's stories are chosen by a person; choose them first")
  const anchor = new Date()
  const snapshots = (await selectEpisodeStories(anchor)).map(s => s.snapshot)
  return { stage: 'selected', episodeStories: snapshots, storyIds: snapshots.map(s => s.id), storiesSelectedAt: anchor }
}

/** selected → scripted: write and validate the dialogue for the frozen stories; the title gets the week prefix. */
async function writeScriptStage(episode: Podcast): Promise<StageWrite> {
  const snapshots = episodeSnapshots(episode)
  const { dialogue, modelId } = await writeEpisodeScript(await loadEpisodeStories(snapshots), episode.kind)
  const label = weekLabel(episode.weekKey)
  return {
    stage: 'scripted',
    title: label ? `${label}: ${dialogue.episodeTitle}` : dialogue.episodeTitle,
    episodeSummary: dialogue.episodeSummary,
    showNotes: buildShowNotes(dialogue.episodeSummary, snapshots, episode.humanEdited, episode.kind),
    script: renderScript(assembleSpokenSegments(dialogue, episode.kind)),
    dialogue,
    scriptModelId: modelId,
  }
}

/** The work that moves an episode out of each stage; a stage without a runner is where it rests. */
const STAGE_RUNNERS: Partial<Record<PodcastStage, StageRunner>> = {
  created: selectStage,
  selected: writeScriptStage,
  scripted: (episode, ctx) => voiceEpisode(episode, ctx),
  voiced: (episode, ctx) => finishEpisode(episode, ctx),
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

/**
 * Run the episode's remaining stages: all of them in automated mode, up to the next review stop in
 * interactive mode. The mode is re-read after every stage, so a switch takes effect at the next
 * boundary. `busy` when another process holds the lease.
 */
export async function advanceEpisode(id: string, opts: AdvanceOptions): Promise<AdvanceResult> {
  if (!opts.leaseHeld && !(await claimEpisode(id))) return { status: 'busy' }
  const ctx: AudioStageContext = {
    trigger: opts.trigger,
    renewLease: () => renewLease(id),
    storeChunk: chunk => storeChunkFenced(id, chunk),
  }
  try {
    let episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
    if (episode.stage === 'legacy') throw new Error('a legacy episode cannot be advanced')
    let run = STAGE_RUNNERS[episode.stage]
    while (run) {
      await renewLease(id)
      const write = await run(episode, ctx)
      await fencedUpdate(id, { ...write, lastError: null, failedAt: null })
      log.info({ podcastId: id, stage: write.stage, trigger: opts.trigger }, 'podcast stage written')
      // `ready` holds the uploaded MP3; the voiced chunks have served their purpose.
      if (write.stage === 'ready') await prisma.podcastAudioChunk.deleteMany({ where: { podcastId: id } })
      episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
      run = pausesForReview(episode) ? undefined : STAGE_RUNNERS[episode.stage]
    }
    return { status: 'done', stage: episode.stage }
  } catch (err) {
    if (!isQuietStop(err)) await recordFailure(id, err)
    throw err
  } finally {
    await releaseEpisode(id)
  }
}

// ---------------------------------------------------------------------------
// Rewind (an admin action, never a pipeline step)
// ---------------------------------------------------------------------------

export type RewindTarget = 'created' | 'selected' | 'scripted'

export interface RewindOptions {
  /** The dry-run flag the rewound row takes (the current config's). */
  dryRun: boolean
  /** The caller holds the lease and keeps it (a rewind that a background run continues). */
  leaseHeld?: boolean
  /** Stored with the rewind; a person stepping back makes the episode interactive. */
  mode?: PodcastMode
}

const AUDIO_CLEARED = {
  ttsModelId: null, voiceIds: Prisma.DbNull, audioUrl: null, audioPath: null, transcriptUrl: null, transcriptPath: null,
  audioBytes: null, durationSec: null, readyAt: null,
} satisfies Prisma.PodcastUpdateManyMutationInput

const SCRIPT_CLEARED = {
  dialogue: Prisma.DbNull, script: '', episodeSummary: '', showNotes: '', scriptModelId: null, ttsSeed: null,
} satisfies Prisma.PodcastUpdateManyMutationInput

const STORIES_CLEARED = {
  episodeStories: Prisma.DbNull, storyIds: [], storiesSelectedAt: null, humanEdited: false,
} satisfies Prisma.PodcastUpdateManyMutationInput

/** ElevenLabs takes a 32-bit seed; this stays inside Postgres' integer. */
const freshSeed = () => randomInt(1, 2 ** 31 - 1)

/**
 * The write that takes an episode back to `to`, clearing that stage's successors' output: to
 * `scripted` the audio (with a fresh seed, so "Regenerate audio" gives a new take); to `selected`
 * also the script and the title (back to its default); to `created` also the stories and the
 * "edited by a person" flag.
 */
function rewindWrite(episode: Podcast, to: RewindTarget, opts: RewindOptions): Prisma.PodcastUpdateManyMutationInput {
  const base = { stage: to, dryRun: opts.dryRun, lastError: null, failedAt: null, ...AUDIO_CLEARED, ...(opts.mode ? { mode: opts.mode } : {}) }
  if (to === 'scripted') return { ...base, ttsSeed: freshSeed() }
  const scriptCleared = { ...base, ...SCRIPT_CLEARED, title: defaultEpisodeTitle(episode) }
  return to === 'selected' ? scriptCleared : { ...scriptCleared, ...STORIES_CLEARED }
}

/** Refuses legacy and published rows and a target that is not before the stage (`created` again only resets the dry-run flag). */
function assertRewindable(episode: Podcast, to: RewindTarget): void {
  if (episode.stage === 'legacy') throw new PodcastRefusedError('a legacy episode cannot be changed')
  if (wasPublished(episode)) throw new PodcastRefusedError('a published episode cannot be changed')
  const back = stageIndex(to) < stageIndex(episode.stage) || (to === 'created' && episode.stage === 'created')
  if (!back) throw new PodcastRefusedError(`the episode is at ${episode.stage} and cannot go back to ${to}`)
}

async function rewindHeld(episode: Podcast, to: RewindTarget, opts: RewindOptions, update: HeldEpisode['update']): Promise<Podcast> {
  assertRewindable(episode, to)
  await update(rewindWrite(episode, to, opts))
  // Every target is before `voiced`, so the stored chunks belong to audio that is gone.
  await prisma.podcastAudioChunk.deleteMany({ where: { podcastId: episode.id } })
  return episode
}

/**
 * Take an episode back to an earlier stage under its lease (ADR-0008). Refuses an episode in
 * progress, a legacy or published one, and a target that is not before the stage. The previous
 * MP3 and VTT are deleted best-effort afterwards (a new render always gets a new file name).
 */
export async function rewindEpisode(id: string, to: RewindTarget, opts: RewindOptions): Promise<void> {
  const previous = opts.leaseHeld
    ? await rewindHeld(await prisma.podcast.findUniqueOrThrow({ where: { id } }), to, opts, data => fencedUpdate(id, data))
    : await withEpisodeLease(id, ({ episode, update }) => rewindHeld(episode, to, opts, update), 'changed')
  await deleteEpisodeObjects(previous)
}
