import { describe, it, expect } from 'vitest'
import { publicTranscript } from './podcastTranscript.js'
import { podcastOpener, podcastSignOff } from '../lib/aiLabelCopy.js'
import type { EpisodeStory } from './podcastScript.js'

const STORIES: EpisodeStory[] = [
  { ref: 1, id: 's1', title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://x.example/1', slug: 'air', issue: 'Planet' },
  { ref: 2, id: 's2', title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://x.example/2', slug: null, issue: 'Health' },
]

const DIALOGUE = {
  episodeTitle: 'Clean air',
  episodeSummary: 'Two stories.',
  segments: [
    { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome to the week.' }] },
    { kind: 'story', storyRef: 1, turns: [{ speaker: 'HOST_B', text: '[thoughtful] A court   ruled on air data.' }, { speaker: 'HOST_A', text: '[laughs]' }] },
    { kind: 'story', storyRef: 2, turns: [{ speaker: 'HOST_A', text: 'From air to health. [excited] Vaccines!' }] },
    { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_B', text: 'That was the week.' }] },
  ],
}

describe('publicTranscript', () => {
  it('reads the episode as spoken: the code-added opener first and the sign-off last, by Host A', () => {
    const transcript = publicTranscript(DIALOGUE, 'standalone', STORIES)
    expect(transcript[0]).toEqual({ story: null, turns: [{ speaker: 'Host A', text: podcastOpener('standalone') }] })
    expect(transcript.at(-1)).toEqual({ story: null, turns: [{ speaker: 'Host A', text: podcastSignOff('standalone') }] })
    expect(transcript).toHaveLength(6)
  })

  it('labels the hosts generically and leaves the audio tags out of the text', () => {
    const transcript = publicTranscript(DIALOGUE, 'weekly', STORIES)
    expect(transcript[2].turns).toEqual([{ speaker: 'Host B', text: 'A court ruled on air data.' }])
    expect(transcript[3].turns).toEqual([{ speaker: 'Host A', text: 'From air to health. Vaccines!' }])
  })

  it('drops a turn that was only audio tags', () => {
    const transcript = publicTranscript(DIALOGUE, 'weekly', STORIES)
    expect(transcript[2].turns).toHaveLength(1)
  })

  it('names the frozen story of each story segment, and none for the intro and outro', () => {
    const transcript = publicTranscript(DIALOGUE, 'weekly', STORIES)
    expect(transcript.map(s => s.story?.title ?? null)).toEqual([null, null, 'Air data ruling', 'Vaccine rollout', null, null])
    expect(transcript[3].story).toEqual({ title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://x.example/2', slug: null })
  })

  it('has no transcript for an episode without a stored dialogue', () => {
    expect(publicTranscript(null, 'weekly', STORIES)).toEqual([])
    expect(publicTranscript({ episodeTitle: 'x' }, 'weekly', STORIES)).toEqual([])
  })
})
