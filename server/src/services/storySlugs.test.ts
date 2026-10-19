import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  story: { findMany: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { generateUniqueSlugs } = await import('./storySlugs.js')

describe('generateUniqueSlugs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty map for empty input', async () => {
    const result = await generateUniqueSlugs([])

    expect(result).toEqual(new Map())
    expect(mockPrisma.story.findMany).not.toHaveBeenCalled()
  })

  it('generates slugs from titles', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Hello World', sourceTitle: 'Source Title' },
    ])

    expect(result.get('s1')).toBe('hello-world')
  })

  it('falls back to sourceTitle when title is null', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await generateUniqueSlugs([
      { id: 's1', title: null, sourceTitle: 'My Source Article' },
    ])

    expect(result.get('s1')).toBe('my-source-article')
  })

  it('resolves conflicts with existing slugs in database', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { slug: 'hello-world' },
    ])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Hello World', sourceTitle: 'Source' },
    ])

    expect(result.get('s1')).toBe('hello-world-2')
  })

  it('resolves conflicts within the same batch', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Same Title', sourceTitle: 'Source 1' },
      { id: 's2', title: 'Same Title', sourceTitle: 'Source 2' },
      { id: 's3', title: 'Same Title', sourceTitle: 'Source 3' },
    ])

    expect(result.get('s1')).toBe('same-title')
    expect(result.get('s2')).toBe('same-title-2')
    expect(result.get('s3')).toBe('same-title-3')
  })

  it('resolves conflicts with both existing and batch slugs', async () => {
    mockPrisma.story.findMany.mockResolvedValue([
      { slug: 'hello-world' },
      { slug: 'hello-world-2' },
    ])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Hello World', sourceTitle: 'Source' },
      { id: 's2', title: 'Hello World', sourceTitle: 'Source' },
    ])

    expect(result.get('s1')).toBe('hello-world-3')
    expect(result.get('s2')).toBe('hello-world-4')
  })

  it('excludes the stories being processed from the conflict check', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    await generateUniqueSlugs([
      { id: 's1', title: 'Test Article', sourceTitle: 'Source' },
    ])

    expect(mockPrisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ['s1'] },
          slug: { not: null },
        }),
      }),
    )
  })

  it('queries DB with unique base slugs for conflict detection', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    await generateUniqueSlugs([
      { id: 's1', title: 'Alpha', sourceTitle: 'S1' },
      { id: 's2', title: 'Beta', sourceTitle: 'S2' },
      { id: 's3', title: 'Alpha', sourceTitle: 'S3' },
    ])

    const call = mockPrisma.story.findMany.mock.calls[0][0]
    // Should have OR conditions for unique bases only (alpha and beta)
    expect(call.where.OR).toHaveLength(2)
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { slug: { startsWith: 'alpha' } },
        { slug: { startsWith: 'beta' } },
      ]),
    )
  })

  it('handles special characters in titles', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'AI & Machine Learning: 2024 Update!', sourceTitle: 'Source' },
    ])

    // slugify converts special chars to hyphens
    expect(result.get('s1')).toBe('ai-machine-learning-2024-update')
  })

  it('returns correct map size for multiple stories', async () => {
    mockPrisma.story.findMany.mockResolvedValue([])

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Article One', sourceTitle: 'Source 1' },
      { id: 's2', title: 'Article Two', sourceTitle: 'Source 2' },
      { id: 's3', title: 'Article Three', sourceTitle: 'Source 3' },
    ])

    expect(result.size).toBe(3)
    expect(result.get('s1')).toBe('article-one')
    expect(result.get('s2')).toBe('article-two')
    expect(result.get('s3')).toBe('article-three')
  })
})
