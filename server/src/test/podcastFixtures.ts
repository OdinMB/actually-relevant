/**
 * A valid two-speaker dialogue and its stories, for podcast tests: four story segments with real
 * bridges, inside the spoken-character band. Helpers replace one segment or one turn.
 */
import type { PodcastDialogue } from '../schemas/llm.js'
import type { DialogueStoryRef } from '../services/podcastDialogue.js'

export type Segment = PodcastDialogue['segments'][number]
export type Turn = Segment['turns'][number]

export const fixtureStories: DialogueStoryRef[] = [
  { ref: 1, title: 'Court orders Nairobi to publish air data', publisher: 'The Guardian' },
  { ref: 2, title: 'Malaria vaccine reaches ten more countries', publisher: 'Phys.org' },
  { ref: 3, title: 'Treaty limits deep-sea mining permits', publisher: 'Reuters' },
  { ref: 4, title: 'New chip export rules take effect', publisher: 'Vox.com' },
]

/** Plain sentences of about `chars` characters, so the episode lands inside the band. */
export function filler(chars: number, seed: string): string {
  const sentence = `The ${seed} detail matters because people can check it. `
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars).trim()
}

const bridges = [
  'A court in Nairobi turning air quality into a legal question is a bigger deal than it sounds.',
  'From clean air to public health: a vaccine rollout reached ten more countries this week.',
  'Health is one kind of shared resource; the deep ocean floor is another, and a new treaty covers it.',
  'The last story moves from the seabed to computer chips, where new export rules now apply.',
]

/** The intro's HOST_A turn leads into the first story, so story 1 opens with HOST_B picking it up. */
export function storySegment(ref: number, overrides: Partial<Segment> = {}): Segment {
  const [first, second]: Turn['speaker'][] = ref === 1 ? ['HOST_B', 'HOST_A'] : ['HOST_A', 'HOST_B']
  const turns: Turn[] = [
    { speaker: first, text: bridges[ref - 1] },
    { speaker: second, text: filler(340, `story ${ref} first`) },
    { speaker: first, text: filler(340, `story ${ref} second`) },
    { speaker: second, text: filler(330, `story ${ref} third`) },
  ]
  return { kind: 'story', storyRef: ref, turns, ...overrides }
}

export const INTRO_TEXT = 'Welcome to Actually Relevant, the stories rated most relevant for humanity this week. '
  + 'We start in Nairobi, where a court has ordered the city to publish its air quality data, The Guardian reports.'

export function goodDialogue(): PodcastDialogue {
  return {
    episodeTitle: 'Clean air, vaccines and the deep sea',
    episodeSummary: 'Four stories from this week. Each one matters beyond its headline.',
    segments: [
      { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: INTRO_TEXT }] },
      storySegment(1),
      storySegment(2),
      storySegment(3),
      storySegment(4),
      { kind: 'outro', storyRef: null, turns: [
        { speaker: 'HOST_A', text: 'From a courtroom in Nairobi to export rules for chips, that was the week in four stories.' },
        { speaker: 'HOST_B', text: 'Each one reaches further than its headline.' },
      ] },
    ],
  }
}

export function withSegment(d: PodcastDialogue, index: number, segment: Segment): PodcastDialogue {
  return { ...d, segments: d.segments.map((s, i) => (i === index ? segment : s)) }
}

export function withTurn(d: PodcastDialogue, segmentIndex: number, turnIndex: number, text: string): PodcastDialogue {
  const seg = d.segments[segmentIndex]
  return withSegment(d, segmentIndex, { ...seg, turns: seg.turns.map((t, i) => (i === turnIndex ? { ...t, text } : t)) })
}
