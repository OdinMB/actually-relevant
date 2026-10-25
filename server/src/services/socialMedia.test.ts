import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
  },
  blueskyPost: {
    findMany: vi.fn(),
  },
  mastodonPost: {
    findMany: vi.fn(),
  },
}))

const mockLlm = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./llm.js', () => ({
  getLLMByTier: vi.fn(() => ({
    withStructuredOutput: vi.fn(() => mockLlm),
  })),
  rateLimitDelay: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../prompts/index.js', () => ({
  buildBlueskyPickBestPrompt: vi.fn(() => 'pick prompt'),
}))

const { findAutoPostCandidates, pickBestStoryForSocial } = await import('./socialMedia.js')

describe('findAutoPostCandidates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty when no published stories', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await findAutoPostCandidates(25, ['bluesky', 'mastodon'])
    expect(result).toEqual([])
  })

  it('with only Bluesky enabled, excludes a story already on Bluesky and never queries Mastodon', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'story-1' }, { id: 'story-2' }])
    mockPrisma.blueskyPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])

    const result = await findAutoPostCandidates(25, ['bluesky'])

    expect(result).toEqual(['story-2'])
    expect(mockPrisma.mastodonPost.findMany).not.toHaveBeenCalled()
  })

  it('counts a post in any status (draft, failed) as already posted', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'story-1' }])
    mockPrisma.blueskyPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])

    const result = await findAutoPostCandidates(25, ['bluesky'])

    expect(result).toEqual([])
    const where = mockPrisma.blueskyPost.findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('status')
  })

  it('returns nothing when no channel is enabled', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'story-1' }])

    const result = await findAutoPostCandidates(25, [])

    expect(result).toEqual([])
  })

  it('returns stories not posted to any channel', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'story-1' }, { id: 'story-2' }, { id: 'story-3' }])
    mockPrisma.blueskyPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])
    mockPrisma.mastodonPost.findMany.mockResolvedValue([{ storyId: 'story-2' }])

    const result = await findAutoPostCandidates(25, ['bluesky', 'mastodon'])

    // story-1 not on Mastodon, story-2 not on Bluesky, story-3 not on either
    expect(result).toContain('story-1')
    expect(result).toContain('story-2')
    expect(result).toContain('story-3')
  })

  it('excludes stories posted to both channels', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'story-1' }, { id: 'story-2' }])
    mockPrisma.blueskyPost.findMany.mockResolvedValue([{ storyId: 'story-1' }, { storyId: 'story-2' }])
    mockPrisma.mastodonPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])

    const result = await findAutoPostCandidates(25, ['bluesky', 'mastodon'])

    // story-1 posted to both — excluded; story-2 only on Bluesky — included
    expect(result).not.toContain('story-1')
    expect(result).toContain('story-2')
  })
})

describe('pickBestStoryForSocial', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the only candidate without LLM call', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 'story-1', title: 'One', titleLabel: 'A', summary: 'S', relevance: 8, emotionTag: 'calm', issue: null, datePublished: null },
    ])

    const result = await pickBestStoryForSocial(['story-1'])
    expect(result.storyId).toBe('story-1')
    expect(mockLlm.invoke).not.toHaveBeenCalled()
  })

  it('calls LLM to pick from multiple candidates', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      {
        id: 'story-1',
        title: 'One',
        titleLabel: 'A',
        summary: 'S1',
        relevance: 8,
        emotionTag: 'calm',
        issue: null,
        datePublished: null,
        sourceTitle: 'Source1',
        relevanceSummary: null,
      },
      {
        id: 'story-2',
        title: 'Two',
        titleLabel: 'B',
        summary: 'S2',
        relevance: 7,
        emotionTag: 'uplifting',
        issue: null,
        datePublished: null,
        sourceTitle: 'Source2',
        relevanceSummary: null,
      },
    ])
    mockLlm.invoke.mockResolvedValue({ storyId: 'story-2', reasoning: 'More engaging' })

    const result = await pickBestStoryForSocial(['story-1', 'story-2'])
    expect(result.storyId).toBe('story-2')
    expect(result.reasoning).toBe('More engaging')
  })

  it('falls back to first candidate if LLM returns invalid ID', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      {
        id: 'story-1',
        title: 'One',
        titleLabel: 'A',
        summary: 'S1',
        relevance: 8,
        emotionTag: 'calm',
        issue: null,
        datePublished: null,
        sourceTitle: 'Source1',
        relevanceSummary: null,
      },
      {
        id: 'story-2',
        title: 'Two',
        titleLabel: 'B',
        summary: 'S2',
        relevance: 7,
        emotionTag: 'calm',
        issue: null,
        datePublished: null,
        sourceTitle: 'Source2',
        relevanceSummary: null,
      },
    ])
    mockLlm.invoke.mockResolvedValue({ storyId: 'nonexistent', reasoning: 'N/A' })

    const result = await pickBestStoryForSocial(['story-1', 'story-2'])
    expect(result.storyId).toBe('story-1')
  })

  it('throws when no stories found', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    await expect(pickBestStoryForSocial(['story-1'])).rejects.toThrow('No stories found')
  })

  describe('for one channel (manual pick and draft)', () => {
    const twoStories = [
      { id: 'story-1', title: 'One', titleLabel: 'A', summary: 'S1', relevance: 8, emotionTag: 'calm', issue: null, datePublished: null },
      { id: 'story-2', title: 'Two', titleLabel: 'B', summary: 'S2', relevance: 7, emotionTag: 'calm', issue: null, datePublished: null },
    ]

    it('skips a story that already has a Mastodon post, so the draft step cannot fail on it', async () => {
      mockPrisma.story.findMany.mockResolvedValue(twoStories)
      mockPrisma.mastodonPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])

      const result = await pickBestStoryForSocial(['story-1', 'story-2'], 'mastodon')

      expect(result.storyId).toBe('story-2')
      expect(mockLlm.invoke).not.toHaveBeenCalled()
      expect(mockPrisma.blueskyPost.findMany).not.toHaveBeenCalled()
    })

    it('skips a story that already has a Bluesky post', async () => {
      mockPrisma.story.findMany.mockResolvedValue(twoStories)
      mockPrisma.blueskyPost.findMany.mockResolvedValue([{ storyId: 'story-2' }])

      const result = await pickBestStoryForSocial(['story-1', 'story-2'], 'bluesky')

      expect(result.storyId).toBe('story-1')
      expect(mockPrisma.mastodonPost.findMany).not.toHaveBeenCalled()
    })

    it('asks the model only about the unposted stories', async () => {
      mockPrisma.story.findMany.mockResolvedValue([...twoStories, { ...twoStories[0]!, id: 'story-3' }])
      mockPrisma.mastodonPost.findMany.mockResolvedValue([{ storyId: 'story-1' }])
      // The model names a story that is already posted: fall back to the first unposted one
      mockLlm.invoke.mockResolvedValue({ storyId: 'story-1', reasoning: 'N/A' })

      const result = await pickBestStoryForSocial(['story-1', 'story-2', 'story-3'], 'mastodon')

      expect(result.storyId).toBe('story-2')
    })

    it('refuses when every selected story already has a post on the channel', async () => {
      mockPrisma.story.findMany.mockResolvedValue(twoStories)
      mockPrisma.mastodonPost.findMany.mockResolvedValue([{ storyId: 'story-1' }, { storyId: 'story-2' }])

      await expect(pickBestStoryForSocial(['story-1', 'story-2'], 'mastodon')).rejects.toThrow('All selected stories already have a Mastodon post')
    })

    it('without a channel, does not look at existing posts (auto-post candidates are filtered already)', async () => {
      mockPrisma.story.findMany.mockResolvedValue([twoStories[0]])

      await pickBestStoryForSocial(['story-1'])

      expect(mockPrisma.blueskyPost.findMany).not.toHaveBeenCalled()
      expect(mockPrisma.mastodonPost.findMany).not.toHaveBeenCalled()
    })
  })
})
