import { describe, it, expect, vi, beforeEach } from 'vitest'

// Cluster formation, election and auto-reject are covered against PostgreSQL in
// storyLifecycle.db.test.ts; these tests cover candidate lookup and LLM confirmation.

// ──── Mocks ──────────────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  story: {
    findMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(),
}))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock('./llm.js', () => ({
  getLLMByTier: () => ({
    withStructuredOutput: () => ({ invoke: mockInvoke }),
  }),
  rateLimitDelay: vi.fn(),
}))

vi.mock('../config.js', () => ({
  config: {
    dedup: { maxCandidates: 10, timeWindowDays: 14, enabled: true, modelTier: 'small' },
  },
}))

vi.mock('../lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../prompts/dedup.js', () => ({
  buildDedupPrompt: vi.fn(() => 'mocked-prompt'),
}))

vi.mock('../schemas/llm.js', () => ({
  dedupConfirmationSchema: {},
}))

vi.mock('./storyLifecycle.js', () => ({ reelectPrimary: vi.fn(), withClusterLocks: vi.fn() }))

const { confirmDuplicates, findExistingCluster } = await import('./dedup.js')

// ──── confirmDuplicates ──────────────────────────────────────────────────────

describe('confirmDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for empty candidates', async () => {
    const result = await confirmDuplicates(
      { title: 'Source Article', summary: 'Summary of source' },
      [],
    )

    expect(result).toEqual([])
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('maps LLM response correctly to candidate IDs', async () => {
    const candidates = [
      { id: 'cand-1', title: 'Candidate One', summary: 'Summary one' },
      { id: 'cand-2', title: 'Candidate Two', summary: 'Summary two' },
      { id: 'cand-3', title: 'Candidate Three', summary: 'Summary three' },
    ]

    mockInvoke.mockResolvedValue({
      assessments: [
        { candidateNumber: 1, isDuplicate: true, reason: 'Same event' },
        { candidateNumber: 2, isDuplicate: false, reason: 'Different event' },
        { candidateNumber: 3, isDuplicate: true, reason: 'Same incident' },
      ],
    })

    const result = await confirmDuplicates(
      { title: 'Source Article', summary: 'Summary of source' },
      candidates,
    )

    expect(result).toEqual([
      { id: 'cand-1', isDuplicate: true, reason: 'Same event' },
      { id: 'cand-2', isDuplicate: false, reason: 'Different event' },
      { id: 'cand-3', isDuplicate: true, reason: 'Same incident' },
    ])
  })

  it('handles out-of-range candidateNumber from LLM (warns and filters)', async () => {
    const candidates = [
      { id: 'cand-1', title: 'Candidate One', summary: 'Summary one' },
    ]

    mockInvoke.mockResolvedValue({
      assessments: [
        { candidateNumber: 1, isDuplicate: true, reason: 'Same event' },
        { candidateNumber: 5, isDuplicate: true, reason: 'Out of range' },
        { candidateNumber: 0, isDuplicate: false, reason: 'Zero index' },
      ],
    })

    const result = await confirmDuplicates(
      { title: 'Source Article', summary: 'Summary of source' },
      candidates,
    )

    // Only candidateNumber 1 maps to a valid candidate
    expect(result).toEqual([
      { id: 'cand-1', isDuplicate: true, reason: 'Same event' },
    ])
  })

  it('returns all as non-duplicate when LLM says none match', async () => {
    const candidates = [
      { id: 'cand-1', title: 'Candidate One', summary: 'Summary one' },
      { id: 'cand-2', title: 'Candidate Two', summary: 'Summary two' },
    ]

    mockInvoke.mockResolvedValue({
      assessments: [
        { candidateNumber: 1, isDuplicate: false, reason: 'Different topic' },
        { candidateNumber: 2, isDuplicate: false, reason: 'Unrelated' },
      ],
    })

    const result = await confirmDuplicates(
      { title: 'Source Article', summary: 'Summary of source' },
      candidates,
    )

    expect(result).toHaveLength(2)
    expect(result.every(r => !r.isDuplicate)).toBe(true)
  })
})

// ──── findExistingCluster ──────────────────────────────────────────────────

describe('findExistingCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no stories have clusters', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await findExistingCluster(['story-1', 'story-2'])

    expect(result).toBeNull()
  })

  it('returns cluster of the single clustered story', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { clusterId: 'cluster-A', dateCrawled: new Date('2024-01-05') },
    ])

    const result = await findExistingCluster(['story-1', 'story-2'])

    expect(result).toEqual({ id: 'cluster-A' })
  })

  it('picks cluster of the newest duplicate when multiple share the same cluster', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { clusterId: 'cluster-A', dateCrawled: new Date('2024-01-10') },
      { clusterId: 'cluster-A', dateCrawled: new Date('2024-01-05') },
    ])

    const result = await findExistingCluster(['story-1', 'story-2'])

    expect(result).toEqual({ id: 'cluster-A' })
  })

  it('picks cluster of the newest duplicate when duplicates span multiple clusters', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { clusterId: 'cluster-B', dateCrawled: new Date('2024-01-10') },
      { clusterId: 'cluster-A', dateCrawled: new Date('2024-01-05') },
    ])

    const result = await findExistingCluster(['story-1', 'story-2'])

    expect(result).toEqual({ id: 'cluster-B', otherClusterIds: ['cluster-A'] })
  })

  it('returns otherClusterIds for all non-primary clusters', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { clusterId: 'cluster-C', dateCrawled: new Date('2024-01-15') },
      { clusterId: 'cluster-A', dateCrawled: new Date('2024-01-10') },
      { clusterId: 'cluster-B', dateCrawled: new Date('2024-01-05') },
    ])

    const result = await findExistingCluster(['story-1', 'story-2', 'story-3'])

    expect(result).toEqual({
      id: 'cluster-C',
      otherClusterIds: expect.arrayContaining(['cluster-A', 'cluster-B']),
    })
    expect(result!.otherClusterIds).toHaveLength(2)
  })

  it('queries with correct ordering and filters', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    await findExistingCluster(['s1', 's2'])

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['s1', 's2'] },
        clusterId: { not: null },
      },
      select: { clusterId: true, dateCrawled: true },
      orderBy: { dateCrawled: 'desc' },
    })
  })
})
