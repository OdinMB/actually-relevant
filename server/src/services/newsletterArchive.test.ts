import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  newsletter: { findFirst: vi.fn(), update: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

// Publication dates are the lifecycle's publish move (newsletterLifecycle.db.test.ts)
const { newsletterSlugBase, ensureNewsletterSlug, findFirstIssueWithStory } = await import('./newsletterArchive.js')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.newsletter.findFirst.mockResolvedValue(null)
  mockPrisma.newsletter.update.mockResolvedValue({})
})

describe('newsletterSlugBase', () => {
  it('turns the title into a URL segment and keeps clear of the archive page', () => {
    expect(newsletterSlugBase('Week 42, 2026')).toBe('week-42-2026')
    expect(newsletterSlugBase('  Spring — Special!  ')).toBe('spring-special')
    expect(newsletterSlugBase('Archive')).toBe('archive-issue')
    expect(newsletterSlugBase('???')).toBe('issue')
  })
})

describe('ensureNewsletterSlug', () => {
  it('keeps an existing slug', async () => {
    expect(await ensureNewsletterSlug({ id: 'n1', title: 'Renamed', slug: 'week-42-2026' })).toBe('week-42-2026')
    expect(mockPrisma.newsletter.update).not.toHaveBeenCalled()
  })

  it("takes the next free suffix when the title's slug is taken", async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValueOnce({ id: 'other' }).mockResolvedValueOnce(null)
    expect(await ensureNewsletterSlug({ id: 'n1', title: 'Week 42, 2026', slug: null })).toBe('week-42-2026-2')
    expect(mockPrisma.newsletter.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { slug: 'week-42-2026-2' } })
  })

  it('moves on when another write takes the slug first', async () => {
    mockPrisma.newsletter.update
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('taken', { code: 'P2002', clientVersion: 'test' }))
      .mockResolvedValueOnce({})
    expect(await ensureNewsletterSlug({ id: 'n1', title: 'Week 42, 2026' })).toBe('week-42-2026-2')
  })
})

describe('findFirstIssueWithStory', () => {
  it('looks among the public issues for one with the story on its shortlist or under a story heading of its content, earliest first', async () => {
    await findFirstIssueWithStory('story-1')
    const query = mockPrisma.newsletter.findFirst.mock.calls[0]![0]
    expect(query.where).toEqual({
      status: 'published',
      slug: { not: null },
      OR: [{ selectedStoryIds: { has: 'story-1' } }, { content: { contains: '{story:story-1}' } }],
    })
    expect(query.orderBy).toEqual([{ publishedAt: 'asc' }, { createdAt: 'asc' }])
  })

  it('answers with the issue as the archive lists it', async () => {
    mockPrisma.newsletter.findFirst.mockResolvedValueOnce({
      slug: 'week-42-2026',
      title: 'Week 42, 2026',
      publishedAt: new Date('2026-10-17T04:30:00Z'),
      createdAt: new Date('2026-10-17T04:00:00Z'),
      selectedStoryIds: ['story-1', 'story-2', 'story-3'],
    })
    expect(await findFirstIssueWithStory('story-1')).toEqual({
      slug: 'week-42-2026',
      title: 'Week 42, 2026',
      publishedAt: '2026-10-17T04:30:00.000Z',
      storyCount: 3,
    })
  })

  it('is null when no public issue carried the story', async () => {
    expect(await findFirstIssueWithStory('story-1')).toBeNull()
  })
})
