import { describe, it, expect, vi, beforeEach } from 'vitest'
import { samplePodcast } from '../test/helpers.js'

const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  podcast: { create: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  story: { findMany: vi.fn(), count: vi.fn() },
}))
const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./llm.js', () => ({
  getLLMByTier: vi.fn(() => ({ withStructuredOutput: vi.fn(() => ({ invoke: mockInvoke })) })),
  rateLimitDelay: vi.fn().mockResolvedValue(undefined),
}))

const { createStandaloneEpisode, searchStandaloneStories, suggestStandaloneStories, saveStandaloneStories } = await import('./podcastStandalone.js')
const { publishedStoryWhere } = await import('./story.js')
const { PodcastRefusedError } = await import('./podcastGuards.js')
const { PodcastEditRejectedError } = await import('./podcastEditing.js')
const { config } = await import('../config.js')

const NOW = new Date('2026-10-07T09:30:00Z')
const CRAWLED = new Date('2026-09-01T10:00:00Z')

function story(n: number) {
  return {
    id: `story-${n}`, title: `Headline ${n}`, sourceTitle: `Source ${n}`, sourceUrl: `https://news.example/${n}`, slug: `headline-${n}`,
    summary: `Summary ${n}`, relevanceSummary: null, relevanceReasons: null, antifactors: null, relevance: 7, emotionTag: null, dateCrawled: CRAWLED,
    issue: { name: `Issue ${n}`, parent: null }, feed: { title: `Publisher ${n}`, displayTitle: null, issue: null },
  }
}

const standalone = (overrides: Record<string, unknown> = {}) => samplePodcast({ kind: 'standalone', weekKey: null, ...overrides })

/** The data of every fenced write but the lease release. */
const writes = () => mockPrisma.podcast.updateMany.mock.calls.map(c => c[0].data).filter(d => !('leaseOwner' in d))

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$executeRaw.mockResolvedValue(1)
  mockPrisma.podcast.updateMany.mockResolvedValue({ count: 1 })
})

describe('createStandaloneEpisode', () => {
  it('creates a standalone row at created without a week key, titled with its UTC creation date', async () => {
    mockPrisma.podcast.create.mockResolvedValueOnce(standalone())
    await createStandaloneEpisode(NOW)
    expect(mockPrisma.podcast.create).toHaveBeenCalledWith({
      data: { kind: 'standalone', stage: 'created', weekKey: null, title: 'Actually Relevant, 2026-10-07', createdAt: NOW, dryRun: config.podcast.dryRun },
    })
  })
})

describe('searchStandaloneStories', () => {
  it('filters through the admin list\'s published where clause and pages the result', async () => {
    mockPrisma.story.findMany.mockResolvedValueOnce([story(3)])
    mockPrisma.story.count.mockResolvedValueOnce(41)
    const filters = { issueId: 'issue-1', search: 'water', crawledAfter: '2026-09-01T00:00:00.000Z' }
    const result = await searchStandaloneStories({ ...filters, page: 3, pageSize: 20 })
    const query = mockPrisma.story.findMany.mock.calls[0][0]
    expect(query.where).toEqual(publishedStoryWhere(filters))
    expect(query.where.status).toBe('published')
    expect(query).toMatchObject({ skip: 40, take: 20 })
    expect(result).toMatchObject({ total: 41, page: 3, pageSize: 20, totalPages: 3, minStories: config.podcast.minStories, maxStories: config.podcast.maxStories })
    expect(result.data).toEqual([{ id: 'story-3', title: 'Headline 3', publisher: 'Publisher 3', sourceUrl: 'https://news.example/3', slug: 'headline-3', issue: 'Issue 3', relevance: 7, dateCrawled: CRAWLED }])
  })

  it('lists the most relevant first with unrated stories last, then the newest', async () => {
    mockPrisma.story.findMany.mockResolvedValueOnce([])
    mockPrisma.story.count.mockResolvedValueOnce(0)
    await searchStandaloneStories({})
    expect(mockPrisma.story.findMany.mock.calls[0][0].orderBy).toEqual([{ relevance: { sort: 'desc', nulls: 'last' } }, { dateCrawled: 'desc' }])
  })
})

describe('suggestStandaloneStories', () => {
  it('returns the model\'s choice in its order from the filtered pool, capped at suggestPoolMax, and writes nothing', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone())
    mockPrisma.story.findMany.mockResolvedValueOnce([1, 2, 3, 4, 5].map(story))
    mockInvoke.mockResolvedValueOnce({ raw: {}, parsed: { selectedIds: ['story-4', 'story-1', 'story-5', 'story-2'] } })
    const chosen = await suggestStandaloneStories('podcast-1', { search: 'water' }, NOW)
    expect(chosen.map(s => s.id)).toEqual(['story-4', 'story-1', 'story-5', 'story-2'])
    const query = mockPrisma.story.findMany.mock.calls[0][0]
    expect(query.take).toBe(config.podcast.suggestPoolMax)
    expect(query.where).toEqual(publishedStoryWhere({ search: 'water' }))
    expect(mockPrisma.podcast.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('answers 422 when too few stories match, without calling the model', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone())
    mockPrisma.story.findMany.mockResolvedValueOnce([story(1), story(2)])
    const err = await suggestStandaloneStories('podcast-1', {}, NOW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PodcastEditRejectedError)
    expect((err as Error).message).toMatch(/only 2 stories match the filters; an episode needs 4/)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('refuses a weekly, published, in-progress or scripted episode (409)', async () => {
    for (const episode of [
      samplePodcast(),
      standalone({ publishedAt: new Date('2026-10-01') }),
      standalone({ leaseUntil: new Date(NOW.getTime() + 60_000) }),
      standalone({ stage: 'scripted' }),
    ]) {
      mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(episode)
      await expect(suggestStandaloneStories('podcast-1', {}, NOW)).rejects.toBeInstanceOf(PodcastRefusedError)
    }
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })
})

describe('saveStandaloneStories', () => {
  const ids = ['story-3', 'story-1', 'story-4', 'story-2']

  it('at created writes the snapshot in the given order, moves to selected and interactive, and does not tick the flag', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone())
    mockPrisma.story.findMany.mockResolvedValueOnce([1, 2, 3, 4].map(story))
    await saveStandaloneStories('podcast-1', ids, NOW)
    const [write] = writes()
    expect(write).toMatchObject({ storyIds: ids, storiesSelectedAt: NOW, stage: 'selected', mode: 'interactive' })
    expect(write).not.toHaveProperty('humanEdited')
    expect(write.episodeStories.map((s: { ref: number; id: string }) => [s.ref, s.id])).toEqual([[1, 'story-3'], [2, 'story-1'], [3, 'story-4'], [4, 'story-2']])
    expect(mockPrisma.story.findMany.mock.calls[0][0].where).toEqual({ id: { in: ids }, status: 'published' })
  })

  it('at selected keeps the mode and ticks the flag only when the set or the order changed', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone({ stage: 'selected', mode: 'automated', storyIds: ids }))
    mockPrisma.story.findMany.mockResolvedValueOnce([1, 2, 3, 4].map(story))
    await saveStandaloneStories('podcast-1', ids, NOW)
    expect(writes()[0]).toMatchObject({ humanEdited: false })
    expect(writes()[0]).not.toHaveProperty('mode')
    expect(writes()[0]).not.toHaveProperty('stage')

    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone({ stage: 'selected', storyIds: ids }))
    mockPrisma.story.findMany.mockResolvedValueOnce([1, 2, 3, 4].map(story))
    await saveStandaloneStories('podcast-1', [...ids].reverse(), NOW)
    expect(writes()[1]).toMatchObject({ humanEdited: true })
  })

  it('rejects stories that are not published (422) and saves nothing', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone())
    mockPrisma.story.findMany.mockResolvedValueOnce([1, 2, 3].map(story))
    await expect(saveStandaloneStories('podcast-1', ids, NOW)).rejects.toThrow(/not published: story-4/)
    expect(writes()).toHaveLength(0)
  })

  it('rejects a wrong count before taking the lease', async () => {
    await expect(saveStandaloneStories('podcast-1', ['story-1', 'story-1'], NOW)).rejects.toBeInstanceOf(PodcastEditRejectedError)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('refuses a weekly or published episode (409)', async () => {
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(samplePodcast({ stage: 'selected' }))
    await expect(saveStandaloneStories('podcast-1', ids, NOW)).rejects.toBeInstanceOf(PodcastRefusedError)
    mockPrisma.podcast.findUniqueOrThrow.mockResolvedValueOnce(standalone({ stage: 'selected', status: 'published', publishedAt: new Date() }))
    await expect(saveStandaloneStories('podcast-1', ids, NOW)).rejects.toBeInstanceOf(PodcastRefusedError)
    expect(writes()).toHaveLength(0)
  })
})
