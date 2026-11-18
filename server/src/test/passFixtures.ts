/**
 * A research pass's in-memory input for unit tests (the eval's replay of the pass): a story as
 * research's loader gives it, with one cluster member, and a first pass's input on it, each with
 * defaults a test overrides. The pass's own tests build their richer story in place.
 */
import type { ResearchStory } from '../services/researchInput.js'
import type { PassInput } from '../services/researchPass.js'
import { EMPTY_POOL } from '../services/researchPool.js'
import { storyLayout } from '../services/storyContextLayout.js'

const words = (seed: string, n = 150) => Array.from({ length: n }, (_, i) => `${seed}w${i}`).join(' ')

export function researchStory(extra: Partial<ResearchStory> = {}): ResearchStory {
  const id = extra.id ?? 'story-1'
  const original = {
    storyId: id,
    title: 'Peat fires return to Sumatra',
    url: `https://news.example/${id}`,
    outlet: 'News',
    language: 'en',
    datePublished: '2026-11-14T06:00:00.000Z',
    dateCrawled: '2026-11-14T08:00:00.000Z',
    content: `Fires burned 2.88 million hectares. ${words('original')}`,
  }
  return {
    id,
    slug: id,
    datePublished: '2026-11-14T07:00:00.000Z',
    original,
    assess: {
      title: original.title,
      content: original.content,
      publisher: 'News',
      url: original.url,
      guidelines: { factors: 'f', antifactors: 'a', ratings: 'r' },
      emotionTag: 'calm',
    },
    published: {
      titleLabel: 'Peat fires',
      title: 'Peat fires return to Sumatra',
      summary: 'Fires burned 2.88 million hectares.',
      whyThisMatters: '- Smoke reaches millions.',
      caveats: '- Figures are provisional.',
      relevance: 6,
      relevanceCalculation: '- calc',
      quote: null,
      quoteAttribution: null,
      marketingBlurb: null,
    },
    clusterMembers: [
      {
        ...original,
        storyId: `${id}-member`,
        url: `https://member.example/${id}`,
        outlet: 'Member',
        content: `The member reports the fires. ${words('member')}`,
      },
    ],
    neighbours: [],
    earlier: [],
    ...extra,
  }
}

/** A first pass's input on `story`: an empty pool, no version, the story's own places. */
export function passInput(story: ResearchStory = researchStory(), extra: Partial<PassInput> = {}): PassInput {
  const p = story.published
  return {
    passId: `pass-${story.id}`,
    story,
    pool: EMPTY_POOL,
    version: null,
    lastPassDay: null,
    carried: [],
    today: '2026-11-18',
    current: {
      title: p.title,
      summary: p.summary,
      layout: storyLayout({ url: story.original.url, summary: p.summary, relevanceReasons: p.whyThisMatters, antifactors: p.caveats, research: null }),
    },
    storyDay: story.datePublished.slice(0, 10),
    reusable: [],
    ...extra,
  }
}
