import { describe, it, expect, vi, beforeEach } from 'vitest'

// The edits' writes (membership, election, auto-reject, restore) are covered against PostgreSQL in
// storyLifecycle.db.test.ts; these tests cover reads, argument checks and the delegation.
const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  storyCluster: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
}))

const mockLifecycle = vi.hoisted(() => ({
  withClusterLocks: vi.fn(),
  reelectPrimary: vi.fn(),
  removeFromCluster: vi.fn(),
  mergeClusters: vi.fn(),
  dissolveCluster: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./storyLifecycle.js', () => mockLifecycle)

const {
  getAllClusters,
  getClusterById,
  createManualCluster,
  searchStoriesForCluster,
  setClusterPrimary,
  removeFromCluster,
  mergeClusters,
  dissolveCluster,
  StoriesAlreadyClusteredError,
} = await import('./cluster.js')

/** A transaction client whose story reads answer from `story`. */
function txWith(story: { findUnique?: unknown; updateMany?: unknown; findMany?: unknown } = {}) {
  return {
    story: { findUnique: vi.fn().mockResolvedValue(story.findUnique ?? null), updateMany: vi.fn().mockResolvedValue(story.updateMany ?? { count: 0 }), findMany: vi.fn().mockResolvedValue(story.findMany ?? []) },
    storyCluster: { create: vi.fn().mockResolvedValue({ id: 'new-cluster' }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAllClusters', () => {
  it('returns clusters ordered by createdAt desc', async () => {
    const clusters = [{ id: 'c1' }, { id: 'c2' }]
    mockPrisma.storyCluster.findMany.mockResolvedValue(clusters)

    const result = await getAllClusters()

    expect(result).toEqual(clusters)
    expect(mockPrisma.storyCluster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        include: expect.objectContaining({
          primaryStory: expect.any(Object),
          _count: { select: { stories: true } },
        }),
      }),
    )
  })
})

describe('getClusterById', () => {
  it('returns cluster with stories ordered by dateCrawled', async () => {
    const cluster = { id: 'c1', stories: [] }
    mockPrisma.storyCluster.findUnique.mockResolvedValue(cluster)

    const result = await getClusterById('c1')

    expect(result).toEqual(cluster)
    expect(mockPrisma.storyCluster.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        include: expect.objectContaining({
          stories: expect.objectContaining({
            orderBy: { dateCrawled: 'asc' },
          }),
        }),
      }),
    )
  })
})

describe('setClusterPrimary', () => {
  it('throws if story is not in the cluster', async () => {
    const tx = txWith({ findUnique: { clusterId: 'other-cluster' } })
    mockLifecycle.withClusterLocks.mockImplementation((_ids, fn) => fn(tx, new Set(['c1'])))

    await expect(setClusterPrimary('c1', 's1')).rejects.toThrow('Story is not a member of this cluster')
    expect(mockLifecycle.reelectPrimary).not.toHaveBeenCalled()
  })

  it('throws if story is not found', async () => {
    const tx = txWith()
    mockLifecycle.withClusterLocks.mockImplementation((_ids, fn) => fn(tx, new Set(['c1'])))

    await expect(setClusterPrimary('c1', 's1')).rejects.toThrow('Story is not a member of this cluster')
  })

  it('elects the chosen story under the cluster lock, in editor-cluster mode', async () => {
    const tx = txWith({ findUnique: { clusterId: 'c1' } })
    mockLifecycle.withClusterLocks.mockImplementation((_ids, fn) => fn(tx, new Set(['c1'])))
    mockPrisma.storyCluster.findUnique.mockResolvedValue({ id: 'c1', stories: [] })

    await setClusterPrimary('c1', 's1')

    expect(mockLifecycle.withClusterLocks).toHaveBeenCalledWith(['c1'], expect.any(Function))
    expect(mockLifecycle.reelectPrimary).toHaveBeenCalledWith('c1', 'editor-cluster', tx, 's1')
  })
})

describe('removeFromCluster', () => {
  it('returns null when the module dissolved the cluster', async () => {
    mockLifecycle.removeFromCluster.mockResolvedValue({ dissolved: true })

    expect(await removeFromCluster('c1', 's1')).toBeNull()
    expect(mockLifecycle.removeFromCluster).toHaveBeenCalledWith('c1', 's1')
  })

  it('returns the cluster when it still has members', async () => {
    mockLifecycle.removeFromCluster.mockResolvedValue({ dissolved: false })
    mockPrisma.storyCluster.findUnique.mockResolvedValue({ id: 'c1', stories: [] })

    expect(await removeFromCluster('c1', 's1')).toEqual({ id: 'c1', stories: [] })
  })
})

describe('mergeClusters', () => {
  it('delegates to the module and returns the target', async () => {
    mockLifecycle.mergeClusters.mockResolvedValue(undefined)
    mockPrisma.storyCluster.findUnique.mockResolvedValue({ id: 'c1', stories: [] })

    expect(await mergeClusters('c1', 'c2')).toEqual({ id: 'c1', stories: [] })
    expect(mockLifecycle.mergeClusters).toHaveBeenCalledWith('c1', 'c2')
  })
})

describe('dissolveCluster', () => {
  it('delegates to the module', async () => {
    mockLifecycle.dissolveCluster.mockResolvedValue({ restored: [] })

    await dissolveCluster('c1')

    expect(mockLifecycle.dissolveCluster).toHaveBeenCalledWith('c1')
  })
})

describe('createManualCluster', () => {
  it('throws if fewer than 2 stories', async () => {
    await expect(createManualCluster(['s1'], 's1')).rejects.toThrow(
      'At least 2 stories are required',
    )
  })

  it('throws if primaryStoryId not in storyIds', async () => {
    await expect(createManualCluster(['s1', 's2'], 's3')).rejects.toThrow(
      'Primary story must be one of the selected stories',
    )
  })

  it('throws if some stories not found', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 's1', clusterId: null, title: 'Story 1' },
    ])

    await expect(createManualCluster(['s1', 's2'], 's1')).rejects.toThrow(
      'Stories not found: s2',
    )
  })

  it('throws StoriesAlreadyClusteredError (409, with the story ids) if stories are in clusters', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 's1', clusterId: null, title: 'Story 1' },
      { id: 's2', clusterId: 'existing-cluster', title: 'Story 2' },
    ])

    const err = await createManualCluster(['s1', 's2'], 's1').catch(e => e)
    expect(err).toBeInstanceOf(StoriesAlreadyClusteredError)
    expect(err.status).toBe(409)
    expect(err.storyIds).toEqual(['s2'])
    expect(err.message).toContain('Story 2')
    expect(err.toBody()).toEqual({ error: err.message, storyIds: ['s2'] })
    expect(mockLifecycle.withClusterLocks).not.toHaveBeenCalled()
  })

  it('throws StoriesAlreadyClusteredError when a story was clustered between the check and the write', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 's1', clusterId: null, title: 'Story 1' },
      { id: 's2', clusterId: null, title: 'Story 2' },
    ])
    const tx = txWith({ updateMany: { count: 1 }, findMany: [{ id: 's2', title: 'Story 2' }] })
    mockLifecycle.withClusterLocks.mockImplementation((_ids, fn) => fn(tx, new Set()))

    const err = await createManualCluster(['s1', 's2'], 's1').catch(e => e)
    expect(err).toBeInstanceOf(StoriesAlreadyClusteredError)
    expect(err.storyIds).toEqual(['s2'])
    expect(mockLifecycle.reelectPrimary).not.toHaveBeenCalled()
  })

  it('creates the cluster and elects the chosen primary in editor-cluster mode', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { id: 's1', clusterId: null, title: 'Story 1' },
      { id: 's2', clusterId: null, title: 'Story 2' },
    ])
    const tx = txWith({ updateMany: { count: 2 } })
    mockLifecycle.withClusterLocks.mockImplementation((_ids, fn) => fn(tx, new Set()))
    mockPrisma.storyCluster.findUnique.mockResolvedValue({ id: 'new-cluster', stories: [] })

    const result = await createManualCluster(['s1', 's2'], 's1')

    expect(tx.story.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2'] }, clusterId: null },
      data: { clusterId: 'new-cluster' },
    })
    expect(mockLifecycle.reelectPrimary).toHaveBeenCalledWith('new-cluster', 'editor-cluster', tx, 's1')
    expect(result).toEqual(expect.objectContaining({ id: 'new-cluster' }))
  })
})

describe('searchStoriesForCluster', () => {
  it('searches stories by title excluding trashed', async () => {
    const stories = [
      { id: 's1', title: 'Climate Change', sourceTitle: 'Source', status: 'analyzed', relevance: 7, clusterId: null },
    ]
    mockPrisma.story.findMany.mockResolvedValue(stories)

    const result = await searchStoriesForCluster('climate')

    expect(result).toEqual(stories)
    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: 'trashed' },
          title: { contains: 'climate', mode: 'insensitive' },
        },
        take: 20,
      }),
    )
  })

  it('respects custom limit', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    await searchStoriesForCluster('test', 5)

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    )
  })
})
