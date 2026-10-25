import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    groupBy: vi.fn(),
  },
  newsletter: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  podcast: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  feed: {
    findUnique: vi.fn(),
  },
  storyCluster: {
    delete: vi.fn(),
  },
  $disconnect: vi.fn(),
  $transaction: vi.fn((args: any) => (Array.isArray(args) ? Promise.all(args) : args())),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const mockLifecycleDissolve = vi.hoisted(() => vi.fn())
vi.mock('./storyLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./storyLifecycle.js')>()),
  dissolveCluster: mockLifecycleDissolve,
}))

const { getStoryIdsByStatus, getStories, deleteStory, dissolveCluster, getClusterRedirectSlug, createStory } = await import('./story.js')

describe('getStories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('excludes sourceContent from admin list query', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    mockPrisma.story.count.mockResolvedValue(0)

    await getStories({})

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    expect(call.select).toBeDefined()
    expect(call.select.sourceContent).toBeUndefined()
    expect(call.select.id).toBe(true)
    expect(call.select.title).toBe(true)
    expect(call.select.status).toBe(true)
    expect(call.select.feed).toBeDefined()
  })

  it('applies search filter with OR on title, sourceTitle, summary', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    mockPrisma.story.count.mockResolvedValue(0)

    await getStories({ search: 'climate' })

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    expect(call.where.AND).toHaveLength(1)
    expect(call.where.AND[0].OR).toEqual([
      { title: { contains: 'climate', mode: 'insensitive' } },
      { sourceTitle: { contains: 'climate', mode: 'insensitive' } },
      { summary: { contains: 'climate', mode: 'insensitive' } },
    ])
  })

  it('combines search and rating filters via AND', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    mockPrisma.story.count.mockResolvedValue(0)

    await getStories({ search: 'AI', rating: 'gte5' })

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    // Both should be combined via AND
    expect(call.where.AND).toHaveLength(2)
    // Rating condition
    expect(call.where.AND[0].OR).toEqual([{ relevance: { gte: 5 } }, { relevance: null, relevancePre: { gte: 5 } }])
    // Search condition
    expect(call.where.AND[1].OR).toEqual([
      { title: { contains: 'AI', mode: 'insensitive' } },
      { sourceTitle: { contains: 'AI', mode: 'insensitive' } },
      { summary: { contains: 'AI', mode: 'insensitive' } },
    ])
    // OR should not be on where directly
    expect(call.where.OR).toBeUndefined()
  })

  it('includes feed with issue in select', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    mockPrisma.story.count.mockResolvedValue(0)

    await getStories({})

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    expect(call.select.feed.select.id).toBe(true)
    expect(call.select.feed.select.title).toBe(true)
    expect(call.select.feed.select.issue).toBeDefined()
  })

  it('filters by access tier', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])
    mockPrisma.story.count.mockResolvedValue(0)

    await getStories({ accessTier: 'locked' })

    expect(mockPrisma.story.findMany.mock.calls[0][0].where.accessTier).toBe('locked')
  })
})

describe('createStory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.feed.findUnique.mockResolvedValue({ id: 'feed-1' })
    mockPrisma.story.create.mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data))
  })

  const base = { sourceUrl: 'https://example.com/a', sourceTitle: 'A', sourceContent: 'C', feedId: 'feed-1' }

  it('stores a locked story as rejected, with its access tier', async () => {
    await createStory({ ...base, accessTier: 'locked' })

    expect(mockPrisma.story.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', accessTier: 'locked' })
  })

  it.each([['metered'], ['unknown'], ['free'], [undefined]] as const)('stores a %s story as fetched', async accessTier => {
    await createStory({ ...base, accessTier })

    expect(mockPrisma.story.create.mock.calls[0][0].data).toMatchObject({ status: 'fetched', accessTier: accessTier ?? null })
  })
})

describe('getStoryIdsByStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns story IDs filtered by status', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'id-1' }, { id: 'id-2' }])

    const result = await getStoryIdsByStatus('analyzed')

    expect(result).toEqual(['id-1', 'id-2'])
    expect(mockPrisma.story.findMany).toHaveBeenCalledWith({
      where: { status: 'analyzed' },
      select: { id: true },
      orderBy: { dateCrawled: 'desc' },
    })
  })

  it('returns empty array when no stories match', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await getStoryIdsByStatus('published')

    expect(result).toEqual([])
  })

  it('applies ratingMin filter (relevancePre >= value)', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'id-3' }])

    await getStoryIdsByStatus('pre_analyzed', { ratingMin: 3 })

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'pre_analyzed',
          relevancePre: { gte: 3 },
        },
      }),
    )
  })

  it('applies relevanceMin filter (relevance >= value)', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'id-4' }])

    await getStoryIdsByStatus('analyzed', { relevanceMin: 5 })

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'analyzed',
          relevance: { gte: 5 },
        },
      }),
    )
  })

  it('applies hoursAgo filter (dateCrawled >= now - hours)', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockPrisma.story.findMany.mockResolvedValue([])

    await getStoryIdsByStatus('fetched', { hoursAgo: 24 })

    const expectedDate = new Date(now - 24 * 60 * 60 * 1000)
    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'fetched',
          dateCrawled: { gte: expectedDate },
        },
      }),
    )

    vi.restoreAllMocks()
  })

  it('applies limit option as take parameter', async () => {
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'id-5' }])

    await getStoryIdsByStatus('analyzed', { limit: 10 })

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    )
  })

  it('does not include take when limit is not provided', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    await getStoryIdsByStatus('fetched')

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    expect(call).not.toHaveProperty('take')
  })

  it('combines multiple filter options', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockPrisma.story.findMany.mockResolvedValue([{ id: 'id-6' }])

    await getStoryIdsByStatus('pre_analyzed', {
      ratingMin: 3,
      relevanceMin: 5,
      hoursAgo: 48,
      limit: 20,
    })

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith({
      where: {
        status: 'pre_analyzed',
        relevancePre: { gte: 3 },
        relevance: { gte: 5 },
        dateCrawled: { gte: new Date(now - 48 * 60 * 60 * 1000) },
      },
      select: { id: true },
      orderBy: { dateCrawled: 'desc' },
      take: 20,
    })

    vi.restoreAllMocks()
  })
})

describe('deleteStory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes story and removes its ID from newsletters and podcasts', async () => {
    mockPrisma.story.delete.mockResolvedValue({})
    mockPrisma.newsletter.findMany.mockResolvedValue([{ id: 'nl-1', storyIds: ['s1', 's2', 's3'] }])
    mockPrisma.podcast.findMany.mockResolvedValue([{ id: 'p-1', storyIds: ['s1', 's3'] }])
    mockPrisma.newsletter.update.mockResolvedValue({})
    mockPrisma.podcast.update.mockResolvedValue({})

    await deleteStory('s1')

    expect(mockPrisma.story.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(mockPrisma.newsletter.update).toHaveBeenCalledWith({
      where: { id: 'nl-1' },
      data: { storyIds: ['s2', 's3'] },
    })
    expect(mockPrisma.podcast.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { storyIds: ['s3'] },
    })
  })

  it('does not update newsletters/podcasts that do not contain the deleted story', async () => {
    mockPrisma.story.delete.mockResolvedValue({})
    mockPrisma.newsletter.findMany.mockResolvedValue([])
    mockPrisma.podcast.findMany.mockResolvedValue([])

    await deleteStory('s99')

    expect(mockPrisma.newsletter.update).not.toHaveBeenCalled()
    expect(mockPrisma.podcast.update).not.toHaveBeenCalled()
  })
})

describe('dissolveCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws error when story is not in a cluster', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ clusterId: null })

    await expect(dissolveCluster('s1')).rejects.toThrow('Story is not in a cluster')
  })

  it('throws error when story is not found', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)

    await expect(dissolveCluster('s-missing')).rejects.toThrow('Story is not in a cluster')
  })

  it("dissolves the story's cluster through the lifecycle module", async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ clusterId: 'cluster-1' })
    mockLifecycleDissolve.mockResolvedValue({ restored: [] })

    await dissolveCluster('s1')

    expect(mockLifecycleDissolve).toHaveBeenCalledWith('cluster-1')
  })
})

describe('getClusterRedirectSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns primary slug for non-primary cluster member', async () => {
    mockPrisma.story.findFirst.mockResolvedValue({
      id: 'story-member',
      cluster: {
        primaryStoryId: 'story-primary',
        primaryStory: { slug: 'primary-story-slug', status: 'published' },
      },
    })

    const result = await getClusterRedirectSlug('old-member-slug')

    expect(result).toBe('primary-story-slug')
    expect(mockPrisma.story.findFirst).toHaveBeenCalledWith({
      where: { slug: 'old-member-slug', clusterId: { not: null } },
      select: expect.objectContaining({
        id: true,
        cluster: expect.any(Object),
      }),
    })
  })

  it('returns null when story is not in a cluster', async () => {
    mockPrisma.story.findFirst.mockResolvedValue(null)

    const result = await getClusterRedirectSlug('non-clustered-slug')

    expect(result).toBeNull()
  })

  it('returns null when story is the primary', async () => {
    mockPrisma.story.findFirst.mockResolvedValue({
      id: 'story-primary',
      cluster: {
        primaryStoryId: 'story-primary',
        primaryStory: { slug: 'primary-slug', status: 'published' },
      },
    })

    const result = await getClusterRedirectSlug('primary-slug')

    expect(result).toBeNull()
  })

  it('returns null when primary story is not published', async () => {
    mockPrisma.story.findFirst.mockResolvedValue({
      id: 'story-member',
      cluster: {
        primaryStoryId: 'story-primary',
        primaryStory: { slug: 'primary-slug', status: 'analyzed' },
      },
    })

    const result = await getClusterRedirectSlug('member-slug')

    expect(result).toBeNull()
  })

  it('returns null when primary story has no slug', async () => {
    mockPrisma.story.findFirst.mockResolvedValue({
      id: 'story-member',
      cluster: {
        primaryStoryId: 'story-primary',
        primaryStory: { slug: null, status: 'published' },
      },
    })

    const result = await getClusterRedirectSlug('member-slug')

    expect(result).toBeNull()
  })
})
