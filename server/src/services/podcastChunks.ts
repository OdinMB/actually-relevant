/**
 * How the spoken episode is cut into TTS requests and timed back, without I/O: packing segments
 * into chunks, the text continuity each request carries, and the VTT transcript and the JSON
 * chapters, both timed from the voiced chunks' measured durations.
 */
import type { SpokenSegment, Turn } from './podcastDialogue.js'

export type Chunk = Turn[]

export const chunkChars = (chunk: Chunk): number => chunk.reduce((n, t) => n + t.text.length, 0)
const chunkText = (chunk: Chunk): string => chunk.map(t => t.text).join(' ')

/**
 * Pack whole segments into chunks of at most `maxChars`, starting a new chunk at a segment
 * boundary whenever the next segment does not fit. A segment longer than `maxChars` on its own is
 * split at turn boundaries only. Turns are never split, so a chunk that starts a segment starts
 * with that segment's bridge turn.
 */
export function chunkTurns(segments: SpokenSegment[], maxChars: number): Chunk[] {
  const chunks: Chunk[] = []
  let current: Chunk = []
  const flush = () => {
    if (current.length > 0) chunks.push(current)
    current = []
  }
  const fits = (turns: Turn[]) => chunkChars(current) + chunkChars(turns) <= maxChars

  for (const segment of segments) {
    if (!fits(segment.turns)) flush()
    if (fits(segment.turns)) {
      current.push(...segment.turns)
      continue
    }
    for (const turn of segment.turns) {
      if (!fits([turn])) flush()
      current.push(turn)
    }
  }
  flush()
  return chunks
}

/** The text spoken around chunk `index`: the end of the one before and the start of the one after. */
export function chunkContinuity(chunks: Chunk[], index: number, contextChars: number): { previousText?: string; futureText?: string } {
  return {
    ...(index > 0 ? { previousText: chunkText(chunks[index - 1]!).slice(-contextChars) } : {}),
    ...(index < chunks.length - 1 ? { futureText: chunkText(chunks[index + 1]!).slice(0, contextChars) } : {}),
  }
}

const TAG_RE = /\[[^\]\n]{1,40}\]/g

/** The generic host names a listener reads in the VTT and on the transcript page. */
export const SPEAKER_LABEL = { HOST_A: 'Host A', HOST_B: 'Host B' } as const

/** A turn's text as a reader sees it: audio tags are not spoken, so they are left out. */
export const readableText = (text: string): string => text.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim()

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`
}

interface TimedTurn {
  turn: Turn
  startMs: number
  endMs: number
}

/**
 * Every turn of the episode, in spoken order, with its approximate place in the MP3. Within each
 * chunk the turns share its measured duration in proportion to their characters (exact timings
 * would need the timestamps endpoint); each chunk starts after the preceding chunks' durations
 * plus the pauses inserted between them at assembly. The VTT and the chapters both read this.
 */
function timeTurns(chunks: Chunk[], durationsMs: number[], pauseMs: number): TimedTurn[] {
  if (durationsMs.length !== chunks.length) throw new Error(`${chunks.length} chunks but ${durationsMs.length} durations`)
  const timed: TimedTurn[] = []
  let offset = 0
  chunks.forEach((chunk, i) => {
    const total = Math.max(1, chunkChars(chunk))
    const durationMs = durationsMs[i]!
    let at = offset
    for (const turn of chunk) {
      const end = at + (durationMs * turn.text.length) / total
      timed.push({ turn, startMs: at, endMs: end })
      at = end
    }
    offset += durationMs +(i < chunks.length - 1 ? pauseMs : 0)
  })
  return timed
}

/**
 * The WebVTT transcript: one cue per turn, timed by `timeTurns` (approximate by design). Audio tags
 * are not spoken, so they are left out of the cue text.
 */
export function buildTranscriptVtt(chunks: Chunk[], durationsMs: number[], pauseMs: number): string {
  const cues = timeTurns(chunks, durationsMs, pauseMs).flatMap(({ turn, startMs, endMs }) => {
    const text = readableText(turn.text)
    return text === '' ? [] : [`${timestamp(startMs)} --> ${timestamp(endMs)}\n<v ${SPEAKER_LABEL[turn.speaker]}>${text}`]
  })
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

/** A story as a chapter names and links it. */
export interface ChapterStory {
  ref: number
  /** The story's headline, as the episode froze it. */
  title: string
  /** Our story page; null when the story has no slug. */
  url: string | null
}

export interface Chapter {
  /** Seconds from the start of the MP3. */
  startTime: number
  title: string
  url?: string
}

/** A Podcasting 2.0 JSON chapters document (`application/json+chapters`, spec version 1.2.0). */
export interface ChaptersDocument {
  version: '1.2.0'
  chapters: Chapter[]
}

/** Titles of the chapters that are not about a story. Plain navigation, not AI-label wording. */
export const CHAPTER_TITLE = { opening: 'Introduction', closing: 'Wrap-up' } as const

const seconds = (ms: number) => Math.round(ms) / 1000

/**
 * The episode's chapters, timed exactly like the VTT (`timeTurns`, the same chunks, durations and
 * pause): an opening chapter (the opener and the intro), one per story segment titled with the
 * story's headline and linking its story page, and a closing one (the outro and the sign-off).
 * Consecutive segments about the same story make one chapter; a story segment whose story is
 * unknown runs on as part of the chapter before it. No LLM call: titles come from the snapshot.
 */
export function buildChapters(
  segments: SpokenSegment[],
  chunks: Chunk[],
  durationsMs: number[],
  pauseMs: number,
  stories: ChapterStory[],
): ChaptersDocument {
  const timed = timeTurns(chunks, durationsMs, pauseMs)
  const turnCount = segments.reduce((n, s) => n + s.turns.length, 0)
  if (turnCount !== timed.length) throw new Error(`${turnCount} turns in the segments but ${timed.length} in the chunks`)

  const byRef = new Map(stories.map(s => [s.ref, s]))
  const chapters: Chapter[] = []
  let lastKey: string | null = null
  let turnIndex = 0
  for (const segment of segments) {
    const startMs = segment.turns.length > 0 ? timed[turnIndex]!.startMs : null
    turnIndex += segment.turns.length
    if (startMs === null) continue

    const story = segment.kind === 'story' && segment.storyRef != null ? byRef.get(segment.storyRef) : undefined
    const startTime = seconds(startMs)
    let key: string
    let chapter: Chapter
    if (story) {
      key = `story:${story.ref}`
      chapter = { startTime, title: story.title, ...(story.url ? { url: story.url } : {}) }
    } else if (segment.kind === 'opener' || segment.kind === 'intro') {
      key = 'opening'
      chapter = { startTime, title: CHAPTER_TITLE.opening }
    } else if (segment.kind === 'outro' || segment.kind === 'signoff') {
      key = 'closing'
      chapter = { startTime, title: CHAPTER_TITLE.closing }
    } else {
      continue
    }
    if (key === lastKey) continue
    lastKey = key
    chapters.push(chapter)
  }
  return { version: '1.2.0', chapters }
}
