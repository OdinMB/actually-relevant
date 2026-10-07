/**
 * How the spoken episode is cut into TTS requests and timed back, without I/O: packing segments
 * into chunks, the text continuity each request carries, and the VTT transcript timed from the
 * voiced chunks' measured durations.
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
    ...(index > 0 ? { previousText: chunkText(chunks[index - 1]).slice(-contextChars) } : {}),
    ...(index < chunks.length - 1 ? { futureText: chunkText(chunks[index + 1]).slice(0, contextChars) } : {}),
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

/**
 * The WebVTT transcript. Within each chunk the turns share its measured duration in proportion to
 * their characters (approximate; exact timings would need the timestamps endpoint); each chunk
 * starts after the preceding chunks' durations plus the pauses inserted between them at assembly.
 * Audio tags are not spoken, so they are left out of the cue text.
 */
export function buildTranscriptVtt(chunks: Chunk[], durationsMs: number[], pauseMs: number): string {
  if (durationsMs.length !== chunks.length) throw new Error(`${chunks.length} chunks but ${durationsMs.length} durations`)
  const cues: string[] = []
  let offset = 0
  chunks.forEach((chunk, i) => {
    const total = Math.max(1, chunkChars(chunk))
    let at = offset
    for (const turn of chunk) {
      const end = at + (durationsMs[i] * turn.text.length) / total
      const text = readableText(turn.text)
      if (text !== '') cues.push(`${timestamp(at)} --> ${timestamp(end)}\n<v ${SPEAKER_LABEL[turn.speaker]}>${text}`)
      at = end
    }
    offset += durationsMs[i] + (i < chunks.length - 1 ? pauseMs : 0)
  })
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}
