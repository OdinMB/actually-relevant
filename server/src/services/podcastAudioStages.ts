/**
 * The audio stages of the podcast stage machine: `scripted → voiced` (each chunk voiced and stored
 * before the next is paid for) and `voiced → ready` (assembled, uploaded, timed). The stage
 * machine in `podcastPipeline.ts` owns the lease and hands these runners its fenced operations.
 * Dry run is decided here: a dry-run episode always voices with the silent stub.
 */
import { randomBytes } from 'crypto'
import { PodcastStage, type Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { podcastEpisodeAiLine } from '../lib/aiLabelCopy.js'
import { textToDialogue, ElevenLabsQuotaError } from '../lib/elevenlabs.js'
import { assembleEpisodeMp3, cbrDurationMs, silentMp3 } from '../lib/podcastAudio.js'
import { deleteObject, isBunnyConfigured, publicUrl, putObject } from '../lib/bunnyStorage.js'
import type { PodcastDialogue } from '../schemas/llm.js'
import { assembleSpokenSegments } from './podcastDialogue.js'
import { buildTranscriptVtt, chunkChars, chunkContinuity, chunkTurns, type Chunk } from './podcastChunks.js'
import { assertBalanceCovers, assertJobEnabled, PodcastBlockedError, reserveTtsChars, standaloneCopyRefusal } from './podcastGuards.js'

const log = createLogger('podcast-audio')

/** The job row whose `enabled` flag the automatic path re-checks before every TTS call. */
export const GENERATE_PODCAST_JOB = 'generate_podcast'
/** `ttsModelId` stored on a dry-run episode: no model voiced it. */
export const STUB_MODEL_ID = 'stub-silence'

export interface VoicedChunk {
  index: number
  bytes: Buffer
  requestId: string | null
  chars: number
  durationMs: number
}

/** What the stage machine lends an audio stage: its trigger and its lease-fenced operations. */
export interface AudioStageContext {
  trigger: 'cron' | 'admin'
  renewLease(): Promise<void>
  /** Store a voiced chunk, only while this process still holds the lease. */
  storeChunk(chunk: VoicedChunk): Promise<void>
}

export type AudioStageWrite = {
  stage: PodcastStage
  ttsModelId?: string
  voiceIds?: { HOST_A: string; HOST_B: string }
  audioUrl?: string
  audioPath?: string
  transcriptUrl?: string
  transcriptPath?: string
  audioBytes?: number
  durationSec?: number
  readyAt?: Date
}

/** The episode's TTS chunks, rebuilt from the stored dialogue (deterministic, so a resume matches). */
export function episodeChunks(episode: Pick<Podcast, 'id' | 'dialogue' | 'kind'>): Chunk[] {
  if (!episode.dialogue) throw new Error(`podcast ${episode.id} has no dialogue to voice`)
  return chunkTurns(assembleSpokenSegments(episode.dialogue as unknown as PodcastDialogue, episode.kind), config.podcast.chunkMaxChars)
}

const voiceFor = (speaker: 'HOST_A' | 'HOST_B') => (speaker === 'HOST_A' ? config.podcast.voiceIdA : config.podcast.voiceIdB)

/** The render's seed: the episode's own after a "Regenerate audio", otherwise the configured one. */
export const renderSeed = (episode: Pick<Podcast, 'ttsSeed'>): number => episode.ttsSeed ?? config.podcast.ttsSeed

/** Voice one chunk with ElevenLabs, after reserving its characters against the monthly cap. */
async function voiceLive(episode: Podcast, chunks: Chunk[], index: number): Promise<Omit<VoicedChunk, 'index'>> {
  const podcastId = episode.id
  const chars = chunkChars(chunks[index])
  await reserveTtsChars(podcastId, chars)
  try {
    const result = await textToDialogue({
      inputs: chunks[index].map(t => ({ text: t.text, voiceId: voiceFor(t.speaker) })),
      seed: renderSeed(episode),
      ...chunkContinuity(chunks, index, config.podcast.continuityChars),
    })
    log.info({ podcastId, chunk: index, chars, characterCost: result.characterCost, requestId: result.requestId }, 'podcast chunk voiced')
    return { bytes: result.audio, requestId: result.requestId, chars, durationMs: cbrDurationMs(result.audio.length) }
  } catch (err) {
    if (err instanceof ElevenLabsQuotaError) throw new PodcastBlockedError(err.message)
    throw err
  }
}

/** The dry-run stub: silence as long as the chunk would take to speak. No credits, no reservation. */
async function voiceStub(chunks: Chunk[], index: number): Promise<Omit<VoicedChunk, 'index'>> {
  const chars = chunkChars(chunks[index])
  const bytes = await silentMp3(chars / config.podcast.stubCharsPerSecond)
  return { bytes, requestId: null, chars, durationMs: cbrDurationMs(bytes.length) }
}

/**
 * scripted → voiced: voice every chunk not stored yet, in order; a resume pays for nothing twice.
 * A live voicing of a standalone episode whose wording the owner has not confirmed is blocked before
 * any credits are spent; a dry run voices the silent stub as always.
 */
export async function voiceEpisode(episode: Podcast, ctx: AudioStageContext): Promise<AudioStageWrite> {
  const refusal = episode.dryRun ? null : standaloneCopyRefusal(episode.kind)
  if (refusal) throw new PodcastBlockedError(refusal)
  const chunks = episodeChunks(episode)
  const stored = await prisma.podcastAudioChunk.findMany({ where: { podcastId: episode.id }, select: { index: true } })
  const done = new Set(stored.map(c => c.index))
  const pending = chunks.map((_, i) => i).filter(i => !done.has(i))

  if (!episode.dryRun && pending.length > 0) await assertBalanceCovers(pending.reduce((n, i) => n + chunkChars(chunks[i]), 0))
  for (const index of pending) {
    await ctx.renewLease()
    if (ctx.trigger === 'cron') await assertJobEnabled(GENERATE_PODCAST_JOB)
    const voiced = episode.dryRun ? await voiceStub(chunks, index) : await voiceLive(episode, chunks, index)
    await ctx.storeChunk({ index, ...voiced })
  }
  return {
    stage: PodcastStage.voiced,
    ttsModelId: episode.dryRun ? STUB_MODEL_ID : config.podcast.ttsModelId,
    voiceIds: { HOST_A: config.podcast.voiceIdA, HOST_B: config.podcast.voiceIdB },
  }
}

/** A fresh, never reused base path: the CDN may still serve a deleted file under an old name. */
export function episodeObjectBase(episode: Pick<Podcast, 'id' | 'weekKey' | 'dryRun'>): string {
  const suffix = randomBytes(4).toString('hex')
  return `${episode.dryRun ? 'dry-run/' : ''}episodes/${episode.weekKey ?? episode.id}-${suffix}`
}

/**
 * Remove an episode's uploaded MP3 and VTT. Best-effort: a failure leaves an unreferenced file on
 * the CDN, which is logged, never fatal (a new render always gets a new name).
 */
export async function deleteEpisodeObjects(episode: Pick<Podcast, 'id' | 'audioPath' | 'transcriptPath'>): Promise<void> {
  for (const path of [episode.audioPath, episode.transcriptPath]) {
    if (!path) continue
    await deleteObject(path).catch(err => log.warn({ err, podcastId: episode.id, path }, 'could not delete a podcast object from storage'))
  }
}

/** voiced → ready: assemble the MP3, build the VTT, upload both under a fresh name. */
export async function finishEpisode(episode: Podcast, ctx: AudioStageContext): Promise<AudioStageWrite> {
  if (!isBunnyConfigured()) throw new Error('storage not configured: set BUNNY_STORAGE_ZONE and BUNNY_STORAGE_PASSWORD')
  const chunks = episodeChunks(episode)
  const rows = await prisma.podcastAudioChunk.findMany({ where: { podcastId: episode.id }, orderBy: { index: 'asc' } })
  if (rows.length !== chunks.length || rows.some((r, i) => r.index !== i)) {
    throw new Error(`podcast ${episode.id} has ${rows.length} stored chunks for ${chunks.length} expected; regenerate the episode`)
  }

  const pauseMs = config.podcast.segmentPauseMs
  const tags = { title: episode.title, artist: config.podcast.showTitle, album: config.podcast.showTitle, comment: podcastEpisodeAiLine(episode.humanEdited, episode.kind) }
  const { buffer, durationSec } = await assembleEpisodeMp3(rows.map(r => Buffer.from(r.bytes)), tags, { pauseMs, loudnorm: !episode.dryRun })
  const vtt = buildTranscriptVtt(chunks, rows.map(r => r.durationMs), pauseMs)

  const base = episodeObjectBase(episode)
  const audioPath = `${base}.mp3`
  const transcriptPath = `${base}.vtt`
  await ctx.renewLease()
  await putObject(audioPath, buffer, 'audio/mpeg')
  await putObject(transcriptPath, Buffer.from(vtt, 'utf8'), 'text/vtt')
  log.info({ podcastId: episode.id, audioPath, bytes: buffer.length, durationSec }, 'podcast audio uploaded')

  return {
    stage: PodcastStage.ready,
    audioUrl: publicUrl(audioPath),
    audioPath,
    transcriptUrl: publicUrl(transcriptPath),
    transcriptPath,
    audioBytes: buffer.length,
    durationSec,
    readyAt: new Date(),
  }
}
