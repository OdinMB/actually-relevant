import { describe, it, expect } from 'vitest'
import { chunkTurns, chunkContinuity, chunkChars, buildChapters, buildTranscriptVtt, type Chunk } from './podcastChunks.js'
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

describe('buildChapters', () => {
  const at = (ref: number | null, kind: SpokenSegment['kind'], ...turns: Turn[]): SpokenSegment => ({ kind, storyRef: ref, turns })
  const stories = [
    { ref: 1, title: 'Clean air ruling', url: 'https://site.example/stories/clean-air' },
    { ref: 2, title: 'Vaccine rollout', url: null },
  ]

  it('opens with an introduction, gives each story a titled, linked chapter and closes with a wrap-up, timed like the VTT', () => {
    const segments = [
      at(null, 'opener', turn('HOST_A', 20)),
      at(null, 'intro', turn('HOST_A', 20)),
      at(1, 'story', turn('HOST_B', 30), turn('HOST_A', 30)),
      at(2, 'story', turn('HOST_B', 40)),
      at(null, 'outro', turn('HOST_B', 10)),
      at(null, 'signoff', turn('HOST_A', 10)),
    ]
    // Chunk 1: opener, intro and story 1 (100 chars, 4,000 ms); chunk 2: story 2, outro, sign-off (60 chars, 3,000 ms)
    const chunks = chunkTurns(segments, 100)
    expect(chunks.map(chunkChars)).toEqual([100, 60])

    const doc = buildChapters(segments, chunks, [4000, 3000], 700, stories)
    expect(doc).toEqual({
      version: '1.2.0',
      chapters: [
        { startTime: 0, title: 'Introduction' },
        // Story 1 starts after 40 of the first chunk's 100 characters
        { startTime: 1.6, title: 'Clean air ruling', url: 'https://site.example/stories/clean-air' },
        // Story 2 starts the second chunk: 4,000 ms plus the 700 ms pause; no slug, so no url
        { startTime: 4.7, title: 'Vaccine rollout' },
        // 40 of the second chunk's 60 characters later
        { startTime: 6.7, title: 'Wrap-up' },
      ],
    })
    // The VTT puts story 2's first cue at the same instant
    expect(buildTranscriptVtt(chunks, [4000, 3000], 700)).toContain('00:00:04.700 --> ')
  })

  it('merges consecutive segments about the same story and lets an unknown story run on in the chapter before it', () => {
    const segments = [
      at(null, 'opener', turn('HOST_A', 10)),
      at(1, 'story', turn('HOST_B', 10)),
      at(1, 'story', turn('HOST_A', 10)),
      at(9, 'story', turn('HOST_B', 10)),
      at(null, 'signoff', turn('HOST_A', 10)),
    ]
    const chunks = chunkTurns(segments, 1000)
    const titles = buildChapters(segments, chunks, [5000], 700, stories).chapters.map(c => c.title)
    expect(titles).toEqual(['Introduction', 'Clean air ruling', 'Wrap-up'])
  })

  it('refuses chunks that do not hold the segments’ turns', () => {
    const segments = [at(null, 'opener', turn('HOST_A', 10)), at(1, 'story', turn('HOST_B', 10))]
    expect(() => buildChapters(segments, [[turn('HOST_A', 10)]], [1000], 700, stories)).toThrow('2 turns in the segments but 1 in the chunks')
  })
})
