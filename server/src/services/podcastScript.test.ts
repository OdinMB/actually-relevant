import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PodcastDialogue } from '../schemas/llm.js'

const mockPrisma = vi.hoisted(() => ({ story: { findMany: vi.fn(), count: vi.fn() } }))
const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./llm.js', () => ({
  getLLMByTier: vi.fn(() => ({ withStructuredOutput: vi.fn(() => ({ invoke: mockInvoke })) })),
  rateLimitDelay: vi.fn().mockResolvedValue(undefined),
}))

const {
  selectEpisodeStories,
  chooseStories,
  writeEpisodeScript,
  buildShowNotes,
  loadEpisodePool,
  loadEpisodeStories,
  episodePoolSize,
  promptWordingKind,
  TooFewStoriesError,
} = await import('./podcastScript.js')
const { PodcastBlockedError } = await import('./podcastGuards.js')
const { podcastEditionInfo } = await import('./podcastEdition.js')
const { PODCAST_EPISODE_AI_LINE, PODCAST_EPISODE_AI_LINE_EDITED, PODCAST_EPISODE_COPY } = await import('../lib/aiLabelCopy.js')
const { config } = await import('../config.js')

function poolStory(n: number, issue = `Issue ${n}`) {
  return {
    id: `story-${n}`,
    title: `Headline ${n}`,
    sourceTitle: `Source title ${n}`,
    sourceUrl: `https://news.example/${n}`,
    slug: `headline-${n}`,
    summary: `Summary ${n}`,
    relevanceSummary: `Why ${n} matters`,
    relevanceReasons: null,
    antifactors: `Limits ${n}`,
    relevance: 7,
    emotionTag: 'calm',
    issue: { name: issue, parent: null },
    feed: { title: `Publisher ${n}`, displayTitle: null, issue: { name: issue, parent: null } },
  }
}

const raw = { usage_metadata: { input_tokens: 10, output_tokens: 20 } }
const answer = <T>(parsed: T | null) => ({ raw, parsed })

describe('selectEpisodeStories', () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps only ids from the pool, in the model's order, with 1-based refs", async () => {
    mockPrisma.story.findMany.mockResolvedValue([1, 2, 3, 4, 5, 6].map(n => poolStory(n)))
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-3', 'made-up', 'story-1', 'story-6', 'story-2', 'story-3'] }))

    const selected = await selectEpisodeStories(new Date('2026-10-10T06:00:00Z'), 'full')

    expect(selected.map(s => s.snapshot.id)).toEqual(['story-3', 'story-1', 'story-6', 'story-2'])
    expect(selected.map(s => s.snapshot.ref)).toEqual([1, 2, 3, 4])
    expect(selected[0].snapshot).toMatchObject({
      title: 'Headline 3',
      publisher: 'Publisher 3',
      slug: 'headline-3',
      sourceUrl: 'https://news.example/3',
      issue: 'Issue 3',
    })
    expect(selected[0].prompt).toMatchObject({ ref: 1, whyItMatters: 'Why 3 matters', limitingFactors: 'Limits 3' })
  })

  it('never takes more than five stories', async () => {
    mockPrisma.story.findMany.mockResolvedValue([1, 2, 3, 4, 5, 6].map(n => poolStory(n)))
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-1', 'story-2', 'story-3', 'story-4', 'story-5', 'story-6'] }))
    expect(await selectEpisodeStories(new Date(), 'full')).toHaveLength(5)
  })

  it('fails closed when fewer than four valid stories come back', async () => {
    mockPrisma.story.findMany.mockResolvedValue([1, 2, 3, 4, 5].map(n => poolStory(n)))
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-1', 'story-2', 'nope', 'story-1'] }))
    await expect(selectEpisodeStories(new Date(), 'full')).rejects.toThrow(/2 valid stories/)
  })

  it('fails before the call when the week has fewer than four published stories', async () => {
    mockPrisma.story.findMany.mockResolvedValue([poolStory(1), poolStory(2)])
    await expect(selectEpisodeStories(new Date(), 'full')).rejects.toThrow(/2 published stories/)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('throws when the model returns no parsable selection', async () => {
    mockPrisma.story.findMany.mockResolvedValue([1, 2, 3, 4].map(n => poolStory(n)))
    mockInvoke.mockResolvedValue(answer(null))
    await expect(selectEpisodeStories(new Date(), 'full')).rejects.toThrow(/parsable/)
  })

  it("asks for the Actually Uplifting show's selection, and names its short week as uplifting stories", async () => {
    mockPrisma.story.findMany.mockResolvedValue([1, 2, 3, 4].map(n => poolStory(n)))
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-1', 'story-2', 'story-3', 'story-4'] }))
    await selectEpisodeStories(new Date(), 'uplifting')
    expect(JSON.stringify(mockInvoke.mock.calls[0][0])).toContain(podcastEditionInfo('uplifting').showTitle)
    mockPrisma.story.findMany.mockResolvedValue([poolStory(1), poolStory(2)])
    await expect(selectEpisodeStories(new Date(), 'uplifting')).rejects.toThrow(/only 2 published uplifting stories this week/)
  })
})

describe('promptWordingKind', () => {
  it('takes the uplifting wording for the uplifting show, and the kind otherwise', () => {
    expect(promptWordingKind('weekly', 'uplifting')).toBe('uplifting')
    expect(promptWordingKind('weekly', 'full')).toBe('weekly')
    expect(promptWordingKind('standalone', 'full')).toBe('standalone')
  })
})

describe('chooseStories', () => {
  beforeEach(() => vi.clearAllMocks())
  const promptOf = () => JSON.stringify(mockInvoke.mock.calls[0][0])

  it('throws TooFewStoriesError without calling the model when the pool is under the minimum', async () => {
    const err = await chooseStories([poolStory(1), poolStory(2), poolStory(3)], 'standalone').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TooFewStoriesError)
    expect(err).toMatchObject({ available: 3, needed: config.podcast.minStories })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("returns the pool stories in the model's order, without unknown or duplicate ids, capped at the maximum", async () => {
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-6', 'x', 'story-2', 'story-6', 'story-1', 'story-3', 'story-4', 'story-5'] }))
    const chosen = await chooseStories(
      [1, 2, 3, 4, 5, 6].map(n => poolStory(n)),
      'standalone',
    )
    expect(chosen.map(s => s.id)).toEqual(['story-6', 'story-2', 'story-1', 'story-3', 'story-4'])
  })

  it('builds the prompt variant of the kind', async () => {
    mockInvoke.mockResolvedValue(answer({ selectedIds: ['story-1', 'story-2', 'story-3', 'story-4'] }))
    await chooseStories(
      [1, 2, 3, 4].map(n => poolStory(n)),
      'standalone',
    )
    expect(promptOf()).not.toMatch(/this week/)
    vi.clearAllMocks()
    await chooseStories(
      [1, 2, 3, 4].map(n => poolStory(n)),
      'weekly',
    )
    expect(promptOf()).toMatch(/this week's episode/)
  })
})

describe('writeEpisodeScript', () => {
  beforeEach(() => vi.clearAllMocks())

  const selected = [1, 2, 3, 4].map(n => ({
    snapshot: {
      ref: n,
      id: `story-${n}`,
      title: `Headline ${n}`,
      publisher: `Publisher ${n}`,
      sourceUrl: `https://news.example/${n}`,
      slug: `headline-${n}`,
      issue: `Issue ${n}`,
    },
    prompt: { ref: n, issue: `Issue ${n}`, title: `Headline ${n}`, publisher: `Publisher ${n}`, summary: 's', whyItMatters: 'w', limitingFactors: 'l' },
  }))

  const longText = (seed: string) => `The ${seed} part explains what happened and why it matters to many people. `.repeat(5).slice(0, 330).trim()
  const valid: PodcastDialogue = {
    episodeTitle: 'Four stories',
    episodeSummary: 'Two sentences. Plain ones.',
    segments: [
      {
        kind: 'intro',
        storyRef: null,
        turns: [{ speaker: 'HOST_A', text: 'Welcome to Actually Relevant, with the stories rated most relevant this week. First up, Headline 1.' }],
      },
      ...[1, 2, 3, 4].map(n => {
        // After the HOST_A opener and intro, the first story opens with HOST_B.
        const [x, y] = n === 1 ? ['HOST_B' as const, 'HOST_A' as const] : ['HOST_A' as const, 'HOST_B' as const]
        return {
          kind: 'story' as const,
          storyRef: n,
          turns: [
            { speaker: x, text: `Bridge number ${n}: this story connects to the one before it in a clear way.` },
            { speaker: y, text: longText(`b${n}`) },
            { speaker: x, text: longText(`a${n}`) },
            { speaker: y, text: longText(`c${n}`) },
          ],
        }
      }),
      {
        kind: 'outro',
        storyRef: null,
        turns: [
          { speaker: 'HOST_A', text: 'From the first story to the last, that was a week worth hearing about.' },
          { speaker: 'HOST_B', text: 'Each one is worth a second look.' },
        ],
      },
    ],
  }
  const invalid: PodcastDialogue = { ...valid, segments: valid.segments.filter(s => s.storyRef !== 4) }

  it('returns a valid dialogue from the first call', async () => {
    mockInvoke.mockResolvedValueOnce(answer(valid))
    const result = await writeEpisodeScript(selected, 'weekly', 'full')
    expect(result.dialogue).toEqual(valid)
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('regenerates once with the problems when the first dialogue is invalid', async () => {
    mockInvoke.mockResolvedValueOnce(answer(invalid)).mockResolvedValueOnce(answer(valid))
    const result = await writeEpisodeScript(selected, 'weekly', 'full')
    expect(result.dialogue).toEqual(valid)
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    const secondPrompt = JSON.stringify(mockInvoke.mock.calls[1][0])
    expect(secondPrompt).toContain('PREVIOUS_DRAFT_PROBLEMS')
    expect(secondPrompt).toContain('story 4')
  })

  it('counts an unparsable answer as the one regeneration', async () => {
    mockInvoke.mockResolvedValueOnce(answer(null)).mockResolvedValueOnce(answer(valid))
    expect((await writeEpisodeScript(selected, 'weekly', 'full')).dialogue).toEqual(valid)
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValueOnce(answer(null)).mockResolvedValueOnce(answer(invalid))
    await expect(writeEpisodeScript(selected, 'weekly', 'full')).rejects.toBeInstanceOf(PodcastBlockedError)
  })

  it('validates a standalone dialogue with the standalone rules and feeds a relative date back', async () => {
    const standalone = JSON.parse(JSON.stringify(valid).replace(' this week', '').replace('a week worth', 'an episode worth')) as PodcastDialogue
    const dated = { ...standalone, episodeSummary: 'Stories from last month. Plain ones.' }
    mockInvoke.mockResolvedValueOnce(answer(dated)).mockResolvedValueOnce(answer(standalone))
    expect((await writeEpisodeScript(selected, 'standalone', 'full')).dialogue).toEqual(standalone)
    const [firstPrompt, secondPrompt] = mockInvoke.mock.calls.map(c => JSON.stringify(c[0]))
    expect(firstPrompt).not.toMatch(/this week's episode|for humanity this week/)
    expect(secondPrompt).toContain('last month')
  })

  it('blocks the episode when the regeneration is still invalid', async () => {
    mockInvoke.mockResolvedValue(answer(invalid))
    await expect(writeEpisodeScript(selected, 'weekly', 'full')).rejects.toBeInstanceOf(PodcastBlockedError)
    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })

  it("writes an Actually Uplifting episode with that show's wording and the weekly rules", async () => {
    mockInvoke.mockResolvedValueOnce(answer(valid))
    expect((await writeEpisodeScript(selected, 'weekly', 'uplifting')).dialogue).toEqual(valid)
    const prompt = JSON.stringify(mockInvoke.mock.calls[0][0])
    expect(prompt).toContain(podcastEditionInfo('uplifting').showTitle)
    expect(prompt).toContain("this week's episode")
  })
})

describe('buildShowNotes', () => {
  const stories = [
    { ref: 1, id: 's1', title: 'Headline 1', publisher: 'Publisher 1', sourceUrl: 'https://news.example/1', slug: 'headline-1', issue: 'Issue 1' },
    { ref: 2, id: 's2', title: 'Headline 2', publisher: 'Publisher 2', sourceUrl: 'https://news.example/2', slug: null, issue: 'Issue 2' },
  ]

  it('starts with the AI line and links our analysis and the source of each story', () => {
    const notes = buildShowNotes('The summary.', stories, false, 'weekly', 'full')
    expect(notes.split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE)
    expect(notes).toContain('The summary.')
    expect(notes).toContain('/stories/headline-1')
    expect(notes).toContain('https://news.example/1')
    expect(notes).toContain('https://news.example/2')
    expect(notes).not.toContain('/stories/null')
  })

  it('ends with the donation ask and its link', () => {
    const lastLine = buildShowNotes('The summary.', stories, false, 'weekly', 'full').split('\n').at(-1)
    expect(lastLine).toContain('Donate $5 toward running the site')
    expect(lastLine).toContain('https://ko-fi.com/odinmb')
  })

  it('starts with the edited line when a person edited the episode', () => {
    expect(buildShowNotes('The summary.', stories, true, 'weekly', 'full').split('\n')[0]).toBe(PODCAST_EPISODE_AI_LINE_EDITED)
  })

  it("points an Actually Uplifting episode's listeners to more uplifting news, just before the donation ask", () => {
    const { moreLink } = podcastEditionInfo('uplifting')
    const lines = buildShowNotes('The summary.', stories, false, 'weekly', 'uplifting').split('\n')
    expect(lines.at(-2)).toContain(moreLink!.url)
    expect(lines.at(-1)).toContain('https://ko-fi.com/odinmb')
    expect(buildShowNotes('The summary.', stories, false, 'weekly', 'full')).not.toContain(moreLink!.url)
  })

  it('picks the AI line by kind', () => {
    const { aiLine, aiLineEdited } = PODCAST_EPISODE_COPY.standalone
    expect(buildShowNotes('The summary.', stories, false, 'standalone', 'full').split('\n')[0]).toBe(aiLine)
    expect(buildShowNotes('The summary.', stories, true, 'standalone', 'full').split('\n')[0]).toBe(aiLineEdited)
  })
})

describe('the story pool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is anchored on the given date: published stories crawled in the week before it', async () => {
    mockPrisma.story.findMany.mockResolvedValue([poolStory(1)])
    const anchor = new Date('2026-10-10T06:00:00Z')
    const pool = await loadEpisodePool(anchor, 'full')
    const { where } = mockPrisma.story.findMany.mock.calls[0][0]
    expect(where.status).toBe('published')
    expect(where.dateCrawled.lte).toEqual(anchor)
    expect(anchor.getTime() - where.dateCrawled.gte.getTime()).toBe(config.content.storyAssignmentDays * 24 * 60 * 60 * 1000)
    expect(where.emotionTag).toBeUndefined()
    expect(pool).toEqual([
      { id: 'story-1', title: 'Headline 1', publisher: 'Publisher 1', sourceUrl: 'https://news.example/1', slug: 'headline-1', issue: 'Issue 1', relevance: 7 },
    ])
  })

  it("holds only the week's uplifting stories for the Actually Uplifting show, in the same window", async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    const anchor = new Date('2026-10-10T06:00:00Z')
    await loadEpisodePool(anchor, 'uplifting')
    const { where } = mockPrisma.story.findMany.mock.calls[0][0]
    expect(where).toMatchObject({ status: 'published', emotionTag: 'uplifting', dateCrawled: { lte: anchor } })
  })

  it('is counted with the same filter, so a short week is known before any row or model call', async () => {
    mockPrisma.story.count.mockResolvedValue(3)
    const anchor = new Date('2026-10-10T06:00:00Z')
    expect(await episodePoolSize(anchor, 'uplifting')).toBe(3)
    await loadEpisodePool(anchor, 'uplifting')
    expect(mockPrisma.story.count.mock.calls[0][0].where).toEqual(mockPrisma.story.findMany.mock.calls[0][0].where)
  })
})

describe('loadEpisodeStories', () => {
  beforeEach(() => vi.clearAllMocks())
  const snap = (ref: number, n: number) => ({
    ref,
    id: `story-${n}`,
    title: `Frozen ${n}`,
    publisher: `Publisher ${n}`,
    sourceUrl: `https://news.example/${n}`,
    slug: `headline-${n}`,
    issue: `Issue ${n}`,
  })

  it('keeps the snapshot order and refs, with the prompt material read fresh', async () => {
    mockPrisma.story.findMany.mockResolvedValue([poolStory(1), poolStory(3)])
    const loaded = await loadEpisodeStories([snap(1, 3), snap(2, 1)])
    expect(loaded.map(s => s.snapshot.id)).toEqual(['story-3', 'story-1'])
    expect(loaded.map(s => s.prompt.ref)).toEqual([1, 2])
    expect(loaded[0].prompt).toMatchObject({ title: 'Frozen 3', whyItMatters: 'Why 3 matters' })
  })

  it('fails naming a story that is no longer published', async () => {
    mockPrisma.story.findMany.mockResolvedValue([poolStory(1)])
    await expect(loadEpisodeStories([snap(1, 1), snap(2, 9)])).rejects.toThrow(/"Frozen 9" is no longer published/)
  })
})
