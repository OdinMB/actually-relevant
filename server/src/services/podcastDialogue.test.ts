import { describe, it, expect } from 'vitest'
import { PODCAST_OPENER } from '../lib/aiLabelCopy.js'
import type { PodcastDialogue } from '../schemas/llm.js'
import {
  assembleSpokenSegments, dialogueCharBudget, renderScript, validateDialogue, PODCAST_SIGN_OFF,
  type DialogueStoryRef,
} from './podcastDialogue.js'

type Segment = PodcastDialogue['segments'][number]
type Turn = Segment['turns'][number]

const stories: DialogueStoryRef[] = [
  { ref: 1, title: 'Court orders Nairobi to publish air data' },
  { ref: 2, title: 'Malaria vaccine reaches ten more countries' },
  { ref: 3, title: 'Treaty limits deep-sea mining permits' },
  { ref: 4, title: 'New chip export rules take effect' },
]

/** Plain sentences of about `chars` characters, so the episode lands inside the band. */
function filler(chars: number, seed: string): string {
  const sentence = `The ${seed} detail matters because people can check it. `
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars).trim()
}

const bridges = [
  'Our first story starts in a courtroom in Nairobi, where air quality became a legal question.',
  'From clean air to public health: a vaccine rollout reached ten more countries this week.',
  'Health is one kind of shared resource; the deep ocean floor is another, and a new treaty covers it.',
  'The last story moves from the seabed to computer chips, where new export rules now apply.',
]

function storySegment(ref: number, overrides: Partial<Segment> = {}): Segment {
  const turns: Turn[] = [
    { speaker: 'HOST_A', text: bridges[ref - 1] },
    { speaker: 'HOST_B', text: filler(340, `story ${ref} first`) },
    { speaker: 'HOST_A', text: filler(340, `story ${ref} second`) },
    { speaker: 'HOST_B', text: filler(330, `story ${ref} third`) },
  ]
  return { kind: 'story', storyRef: ref, turns, ...overrides }
}

function goodDialogue(): PodcastDialogue {
  return {
    episodeTitle: 'Clean air, vaccines and the deep sea',
    episodeSummary: 'Four stories from this week. Each one matters beyond its headline.',
    segments: [
      { kind: 'intro', storyRef: null, turns: [
        { speaker: 'HOST_B', text: 'Welcome to Actually Relevant, the stories rated most relevant for humanity this week.' },
        { speaker: 'HOST_A', text: 'We have four of them today, from courts to chips.' },
      ] },
      storySegment(1),
      storySegment(2),
      storySegment(3),
      storySegment(4),
      { kind: 'outro', storyRef: null, turns: [
        { speaker: 'HOST_A', text: 'From a courtroom in Nairobi to export rules for chips, that was the week in four stories.' },
        { speaker: 'HOST_B', text: 'Thanks for spending a few minutes with us.' },
      ] },
    ],
  }
}

function withSegment(d: PodcastDialogue, index: number, segment: Segment): PodcastDialogue {
  return { ...d, segments: d.segments.map((s, i) => (i === index ? segment : s)) }
}

function withTurn(d: PodcastDialogue, segmentIndex: number, turnIndex: number, text: string): PodcastDialogue {
  const seg = d.segments[segmentIndex]
  return withSegment(d, segmentIndex, { ...seg, turns: seg.turns.map((t, i) => (i === turnIndex ? { ...t, text } : t)) })
}

function errorsOf(d: PodcastDialogue): string[] {
  return validateDialogue(d, stories).errors
}

describe('validateDialogue', () => {
  it('accepts a dialogue that covers every story with bridges inside the band', () => {
    const result = validateDialogue(goodDialogue(), stories)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects a missing story and a story covered twice', () => {
    const d = goodDialogue()
    const missing = { ...d, segments: d.segments.filter(s => s.storyRef !== 4) }
    expect(errorsOf(missing).join(' ')).toMatch(/story 4/)
    const twice = withSegment(d, 4, storySegment(3, { turns: storySegment(4).turns }))
    expect(errorsOf(twice).join(' ')).toMatch(/story 3/)
  })

  it('rejects a story ref that is not in the episode', () => {
    expect(errorsOf(withSegment(goodDialogue(), 4, storySegment(4, { storyRef: 9 }))).join(' ')).toMatch(/9/)
  })

  it('rejects a dialogue that does not start with the intro and end with the outro', () => {
    const d = goodDialogue()
    const noIntro = { ...d, segments: d.segments.slice(1) }
    expect(validateDialogue(noIntro, stories).valid).toBe(false)
    const noOutro = { ...d, segments: d.segments.slice(0, -1) }
    expect(validateDialogue(noOutro, stories).valid).toBe(false)
  })

  it('rejects the same speaker three times in a row, counting the code-added opener', () => {
    const d = goodDialogue()
    const intro: Segment = { kind: 'intro', storyRef: null, turns: [
      { speaker: 'HOST_A', text: 'Welcome to Actually Relevant, the stories rated most relevant this week.' },
      { speaker: 'HOST_A', text: 'We have four of them today, from courts to chips.' },
    ] }
    expect(errorsOf(withSegment(d, 0, intro)).join(' ')).toMatch(/three|row/i)
  })

  it('rejects a spoken total below or above the band, counting the opener, the sign-off and tags', () => {
    const d = goodDialogue()
    const short = { ...d, segments: d.segments.map(s => ({ ...s, turns: s.turns.slice(0, 1) })) }
    expect(errorsOf(short).join(' ')).toMatch(/spoken characters/)
    const long = { ...d, segments: d.segments.map(s => (s.kind === 'story' ? { ...s, turns: [...s.turns, { speaker: 'HOST_A' as const, text: filler(390, 'extra') }, { speaker: 'HOST_B' as const, text: filler(390, 'more') }] } : s)) }
    expect(errorsOf(long).join(' ')).toMatch(/spoken characters/)
  })

  it('counts the code-added opener and sign-off in the band', () => {
    const d = goodDialogue()
    const total = assembleSpokenSegments(d).flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    const modelOnly = d.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    expect(total).toBe(modelOnly + PODCAST_OPENER.length + PODCAST_SIGN_OFF.length)
  })

  it('rejects a turn over the per-turn limit', () => {
    expect(errorsOf(withTurn(goodDialogue(), 1, 1, filler(420, 'long'))).join(' ')).toMatch(/400/)
  })

  it('rejects unknown audio tags and more than two tags in one turn', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 1, 1, `[laughs] ${filler(300, 'tag')}`)).join(' ')).toMatch(/\[laughs\]/)
    expect(errorsOf(withTurn(d, 1, 1, `[calm] ${filler(300, 'tag')} [serious] and [warmly] more.`)).join(' ')).toMatch(/tags/)
  })

  it('accepts up to two allowlisted tags in one turn', () => {
    expect(errorsOf(withTurn(goodDialogue(), 1, 1, `[calm] ${filler(300, 'tag')} [short pause] more.`))).toEqual([])
  })

  it('rejects URLs, markdown and speaker prefixes in turns', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 1, 2, `${filler(300, 'url')} See https://example.com for more.`)).join(' ')).toMatch(/URL/)
    expect(errorsOf(withTurn(d, 1, 2, `${filler(300, 'md')} This is **important**.`)).join(' ')).toMatch(/markdown/i)
    expect(errorsOf(withTurn(d, 1, 2, `HOST B: ${filler(300, 'prefix')}`)).join(' ')).toMatch(/prefix/)
  })

  it('rejects a story segment whose bridge turn is too short', () => {
    expect(errorsOf(withTurn(goodDialogue(), 2, 0, 'Next, vaccines.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects a story segment that opens with its headline restated', () => {
    expect(errorsOf(withTurn(goodDialogue(), 2, 0, 'Malaria vaccine reaches ten more countries.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects an outro without a bridge back from the last story', () => {
    expect(errorsOf(withTurn(goodDialogue(), 5, 0, 'Bye.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects two consecutive story segments that open with the same first five words', () => {
    const d = goodDialogue()
    const templated = withTurn(
      withTurn(d, 2, 0, 'Next up on our list this week is a vaccine rollout that reached ten more countries.'),
      3, 0, 'Next up on our list this week is a treaty that limits permits for deep-sea mining.',
    )
    expect(errorsOf(templated).join(' ')).toMatch(/five words/)
  })
})

describe('assembleSpokenSegments', () => {
  it('puts the opener first and the sign-off last, both spoken by HOST_A', () => {
    const segments = assembleSpokenSegments(goodDialogue())
    expect(segments[0]).toEqual({ kind: 'opener', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_OPENER }] })
    expect(segments.at(-1)).toEqual({ kind: 'signoff', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_SIGN_OFF }] })
    expect(segments.slice(1, -1).map(s => s.kind)).toEqual(['intro', 'story', 'story', 'story', 'story', 'outro'])
  })
})

describe('dialogueCharBudget', () => {
  it('leaves room for the code-added turns inside the band', () => {
    const { min, max } = dialogueCharBudget()
    const code = PODCAST_OPENER.length + PODCAST_SIGN_OFF.length
    expect(min + code).toBe(4200)
    expect(max + code).toBe(5600)
  })
})

describe('renderScript', () => {
  it('renders every spoken turn with its speaker, segments separated by a blank line', () => {
    const script = renderScript(assembleSpokenSegments(goodDialogue()))
    const lines = script.split('\n')
    expect(lines[0]).toBe(`HOST A: ${PODCAST_OPENER}`)
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^HOST B: Welcome/)
    expect(lines.at(-1)).toBe(`HOST A: ${PODCAST_SIGN_OFF}`)
  })
})
