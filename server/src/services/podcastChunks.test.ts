import { describe, it, expect } from 'vitest'
import { chunkTurns, chunkContinuity, chunkChars, buildTranscriptVtt, type Chunk } from './podcastChunks.js'
import type { SpokenSegment, Turn } from './podcastDialogue.js'

const turn = (speaker: Turn['speaker'], chars: number, mark = 'x'): Turn => ({ speaker, text: mark.repeat(chars) })
const segment = (kind: SpokenSegment['kind'], ...turns: Turn[]): SpokenSegment => ({ kind, storyRef: kind === 'story' ? 1 : null, turns })

describe('chunkTurns', () => {
  it('keeps segments whole and starts a new chunk at a segment boundary when the next does not fit', () => {
    const segments = [
      segment('opener', turn('HOST_A', 80, 'o')),
      segment('story', turn('HOST_B', 300, 'b'), turn('HOST_A', 300)),
      segment('story', turn('HOST_B', 300, 'c'), turn('HOST_A', 300)),
    ]
    const chunks = chunkTurns(segments, 1000)
    expect(chunks.map(c => c.length)).toEqual([3, 2])
    // The second chunk starts with the second story's bridge turn.
    expect(chunks[1][0].text.startsWith('c')).toBe(true)
  })

  it('splits an oversized segment at turn boundaries only, keeping order and the limit', () => {
    const turns = [turn('HOST_B', 400, 'a'), turn('HOST_A', 400, 'b'), turn('HOST_B', 400, 'c'), turn('HOST_A', 400, 'd'), turn('HOST_B', 400, 'e')]
    const chunks = chunkTurns([segment('story', ...turns)], 1000)
    expect(chunks.every(c => chunkChars(c) <= 1000)).toBe(true)
    expect(chunks.flat()).toEqual(turns)
    expect(chunks.map(c => c.length)).toEqual([2, 2, 1])
  })

  it('packs several short segments into one chunk', () => {
    const chunks = chunkTurns([segment('opener', turn('HOST_A', 80)), segment('intro', turn('HOST_A', 200)), segment('story', turn('HOST_B', 300))], 1800)
    expect(chunks).toHaveLength(1)
  })
})

describe('chunkContinuity', () => {
  const chunks: Chunk[] = [[{ speaker: 'HOST_A', text: 'First chunk ends here.' }], [{ speaker: 'HOST_B', text: 'Middle.' }], [{ speaker: 'HOST_A', text: 'Last chunk starts here.' }]]

  it('gives no previous text to the first chunk and no future text to the last', () => {
    expect(chunkContinuity(chunks, 0, 100)).toEqual({ futureText: 'Middle.' })
    expect(chunkContinuity(chunks, 2, 100)).toEqual({ previousText: 'Middle.' })
  })

  it('caps the context at the given number of characters from the near side', () => {
    expect(chunkContinuity(chunks, 1, 10)).toEqual({ previousText: 'ends here.', futureText: 'Last chunk' })
  })
})

describe('buildTranscriptVtt', () => {
  const chunks: Chunk[] = [
    [{ speaker: 'HOST_A', text: 'a'.repeat(30) }, { speaker: 'HOST_B', text: '[calm] ' + 'b'.repeat(3) }],
    [{ speaker: 'HOST_A', text: 'c'.repeat(10) }],
  ]

  it('times turns by characters within a chunk and offsets later chunks by durations plus the pause', () => {
    const vtt = buildTranscriptVtt(chunks, [4000, 2000], 700)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:03.000\n<v Host A>' + 'a'.repeat(30))
    // The tag is billed and timed, but not part of the cue text.
    expect(vtt).toContain('00:00:03.000 --> 00:00:04.000\n<v Host B>bbb')
    // The second chunk starts after 4,000 ms plus the 700 ms pause and ends at the episode's end.
    expect(vtt).toContain('00:00:04.700 --> 00:00:06.700\n<v Host A>' + 'c'.repeat(10))
  })

  it('refuses mismatched durations', () => {
    expect(() => buildTranscriptVtt(chunks, [1000], 700)).toThrow('2 chunks but 1 durations')
  })
})
