import { describe, it, expect } from 'vitest'
import {
  buildResearchedStory,
  earlierStoryIds,
  forReaders,
  researchedStorySchema,
  researchedStoryText,
  storedResearchText,
  type ResearchRunForReaders,
} from './researchedStory.js'
import type { ResearchEarlier, ResearchSource } from './researchPipeline.js'

function source(id: string, over: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id,
    origin: 'search',
    url: `https://www.outlet-${id.toLowerCase()}.example/article`,
    title: `Headline of ${id}`,
    outlet: `Outlet ${id}`,
    date: '2026-11-10',
    favicon: null,
    usedRawContent: false,
    kind: 'news-report',
    country: 'Kenya',
    relation: 'same-development',
    facts: [1, 2].map(n => ({ id: `${id}F${n}`, statement: `Fact ${n} of ${id}.`, supportingSentence: `Sentence ${n} of ${id}.`, measures: '', found: true })),
    voices: [],
    ...over,
  }
}

function earlier(id: string, storyId: string): ResearchEarlier {
  return {
    id,
    storyId,
    slug: `slug-then-${storyId}`,
    title: `Our earlier story ${id}`,
    date: '2026-03-01',
    relation: 'earlier-development',
    facts: [{ id: `${id}F1`, statement: `Earlier fact of ${id}.`, supportingSentence: `Earlier sentence of ${id}.`, measures: '', found: true }],
  }
}

const cited = (text: string, factIds: string[]) => ({ text, factIds })

function run(over: Partial<ResearchRunForReaders['draft']> = {}, sources?: ResearchSource[], earlierStories?: ResearchEarlier[]): ResearchRunForReaders {
  return {
    sources: sources ?? [source('S0', { origin: 'original' }), source('S1'), source('S2'), source('S3')],
    earlier: earlierStories ?? [earlier('E1', 'story-e1'), earlier('E2', 'story-e2')],
    draft: {
      story: [cited('First paragraph.', ['S0F1'])],
      whyThisMatters: [cited('It matters.', [])],
      caveats: [cited('A caveat.', [])],
      quoteSourceId: 'S0',
      ...over,
    },
  }
}

const citationsOf = (text: { citations: { sourceId: string }[] }) => text.citations.map(c => c.sourceId)

describe('buildResearchedStory', () => {
  it('gives each paragraph one cited text, with one citation per source in the order the sources are first cited', () => {
    const story = buildResearchedStory(run({ story: [cited('Two sources.', ['S2F1', 'S0F2', 'S2F2', 'S0F1']), cited('One source.', ['S1F1'])] }))
    expect(story.paragraphs.map(p => p.sentences.map(s => [s.text, citationsOf(s)]))).toEqual([[['Two sources.', ['S2', 'S0']]], [['One source.', ['S1']]]])
  })

  it("gives each citation its source's first supporting sentence, past a publication-date fact that has none", () => {
    const story = buildResearchedStory(run({ story: [cited('Dated.', ['S1F0', 'S1F2', 'S1F1'])] }))
    expect(story.paragraphs[0]!.sentences[0]!.citations).toEqual([{ sourceId: 'S1', sentence: 'Sentence 2 of S1.' }])
  })

  it('cites a source by its publication date alone, with no sentence for the card', () => {
    const story = buildResearchedStory(run({ story: [cited('On Monday.', ['S1F0'])] }))
    expect(story.paragraphs[0]!.sentences[0]!.citations).toEqual([{ sourceId: 'S1', sentence: null }])
  })

  it("drops fact ids that are not in the pool, an undated source's date fact included", () => {
    const sources = [source('S0', { origin: 'original' }), source('S1', { date: null })]
    const story = buildResearchedStory(run({ story: [cited('Unknown.', ['S9F1', 'S1F7', 'S1F0', 'E7F1'])] }, sources))
    expect(story.paragraphs[0]!.sentences[0]!.citations).toEqual([])
  })

  it('lists only the sources something cites, the original article always first and our earlier stories last', () => {
    const story = buildResearchedStory(
      run({
        story: [cited('Earlier and S3.', ['E2F1', 'S3F1'])],
        whyThisMatters: [cited('Matters.', ['S1F1'])],
        quoteSourceId: 'S3',
      }),
    )
    expect(story.sources.map(s => s.id)).toEqual(['S0', 'S1', 'S3', 'E2'])
    expect(story.sources.map(s => s.origin)).toEqual(['original', 'source', 'source', 'earlier'])
  })

  it("lists the quote's source even when no sentence cites it", () => {
    const story = buildResearchedStory(run({ quoteSourceId: 'S2' }))
    expect(story.quoteSourceId).toBe('S2')
    expect(story.sources.map(s => s.id)).toEqual(['S0', 'S2'])
  })

  it('keeps a quote source id only when it names a source of the run', () => {
    expect(buildResearchedStory(run({ quoteSourceId: 'S9' })).quoteSourceId).toBeNull()
    expect(buildResearchedStory(run({ quoteSourceId: 'E1' })).quoteSourceId).toBe('E1')
  })

  it('gives no quote source, and lists none for it, when the run dropped its key quote', () => {
    const story = buildResearchedStory(run({ quoteSourceId: '' }))
    expect(story.quoteSourceId).toBeNull()
    expect(story.sources.map(s => s.id)).toEqual(['S0'])
  })

  it('names our earlier story as Actually Relevant, with its story id and slug and no outside link', () => {
    const story = buildResearchedStory(run({ story: [cited('Earlier.', ['E1F1'])] }))
    expect(story.sources.find(s => s.id === 'E1')).toMatchObject({
      outlet: 'Actually Relevant',
      storyId: 'story-e1',
      slug: 'slug-then-story-e1',
      url: null,
      host: null,
    })
  })

  it("serves a source's host without www for its stored favicon, and no link or host for an address that is not http(s)", () => {
    const sources = [source('S0', { origin: 'original' }), source('S1', { url: 'javascript:alert(1)' })]
    const story = buildResearchedStory(run({ story: [cited('Both.', ['S0F1', 'S1F1'])] }, sources))
    expect(story.sources.map(s => [s.host, s.url])).toEqual([
      ['outlet-s0.example', 'https://www.outlet-s0.example/article'],
      [null, null],
    ])
  })

  it('serves an unknown country as none', () => {
    const sources = [source('S0', { origin: 'original', country: 'unknown' })]
    expect(buildResearchedStory(run({}, sources, [])).sources[0]!.country).toBeNull()
  })

  it('builds what its own schema accepts', () => {
    const story = buildResearchedStory(run({ story: [cited('All.', ['S0F1', 'E1F1'])] }))
    expect(researchedStorySchema.safeParse(story).success).toBe(true)
  })
})

/** A version applied before 2026-11-13, cited after each sentence. */
const perSentence = () => ({
  ...buildResearchedStory(run()),
  paragraphs: [
    {
      sentences: [
        { text: 'One.', citations: [{ sourceId: 'S0', sentence: 'Sentence 1 of S0.' }] },
        { text: 'Two.', citations: [] },
      ],
    },
    { sentences: [{ text: 'Three.', citations: [] }] },
  ],
})

describe('researchedStorySchema', () => {
  const stored = buildResearchedStory(run({ story: [cited('All.', ['S0F1', 'E1F1'])] }))
  const withUrl = (url: string | null) => ({ ...stored, sources: stored.sources.map(s => (s.id === 'S0' ? { ...s, url } : s)) })

  it.each(['https://outlet.example/a', 'http://outlet.example/a', 'HTTPS://outlet.example/a', null])('accepts a source address of %s', url => {
    expect(researchedStorySchema.safeParse(withUrl(url)).success).toBe(true)
  })

  // What reaches a link's href: a stored value that is not http(s) fails the parse, so the story is served without its researched version
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//outlet.example/a',
    'not a url',
  ])('refuses a source address of %s', url => {
    expect(researchedStorySchema.safeParse(withUrl(url)).success).toBe(false)
  })
})

describe('forReaders', () => {
  const built = buildResearchedStory(
    run({
      story: [cited('Both earlier.', ['E1F1', 'E2F1', 'S0F1'])],
      caveats: [cited('Only E2.', ['E2F1'])],
      quoteSourceId: 'E2',
    }),
  )

  it('drops an earlier story that is no longer published, with its citations, and gives the rest their current slug', () => {
    const story = forReaders(built, new Map([['story-e1', 'slug-now']]))
    expect(story.sources.map(s => s.id)).toEqual(['S0', 'E1'])
    expect(story.sources.find(s => s.id === 'E1')!.slug).toBe('slug-now')
    expect(citationsOf(story.paragraphs[0]!.sentences[0]!)).toEqual(['E1', 'S0'])
    expect(story.caveats[0]).toEqual({ text: 'Only E2.', citations: [] })
    expect(story.quoteSourceId).toBeNull()
  })

  it('leaves outside sources alone', () => {
    expect(
      forReaders(
        built,
        new Map([
          ['story-e1', 'a'],
          ['story-e2', 'b'],
        ]),
      ).sources.map(s => s.id),
    ).toEqual(['S0', 'E1', 'E2'])
  })

  it('names the earlier stories it needs to look up', () => {
    expect(earlierStoryIds(built)).toEqual(['story-e1', 'story-e2'])
  })
})

describe('researchedStoryText', () => {
  it('separates the paragraphs, without citations', () => {
    const story = buildResearchedStory(run({ story: [cited('One. Two.', ['S0F1']), cited('Three.', ['S2F1'])] }))
    expect(researchedStoryText(story)).toBe('One. Two.\n\nThree.')
  })
})

describe('storedResearchText', () => {
  const story = buildResearchedStory(run({ story: [cited('One.', ['S0F1']), cited('Two.', ['S1F1'])] }))

  it("reads a stored version's text, as the database gives it back", () => {
    expect(storedResearchText(JSON.parse(JSON.stringify(story)))).toBe('One.\n\nTwo.')
  })

  it('reads a version applied before 2026-11-13, cited per sentence, joining each paragraph’s sentences as before', () => {
    expect(storedResearchText(JSON.parse(JSON.stringify(perSentence())))).toBe('One. Two.\n\nThree.')
  })

  it('gives null for a story without one, or one that fails its schema, as the story page serves it', () => {
    expect(storedResearchText(null)).toBeNull()
    expect(storedResearchText({ ...story, sources: 'none' })).toBeNull()
  })
})
