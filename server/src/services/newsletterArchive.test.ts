import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const mockPrisma = vi.hoisted(() => ({
  newsletter: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  newsletterSend: { findMany: vi.fn() },
}))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))

const { newsletterSlugBase, ensureNewsletterSlug, publicationFields, toWebMarkdown } = await import('./newsletterArchive.js')

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.newsletter.findFirst.mockResolvedValue(null)
  mockPrisma.newsletter.update.mockResolvedValue({})
  mockPrisma.newsletterSend.findMany.mockResolvedValue([])
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

describe('publicationFields', () => {
  it('assigns a slug and the first publication date when an issue is published', async () => {
    mockPrisma.newsletter.findUnique.mockResolvedValue({ id: 'n1', title: 'Week 42, 2026', slug: null, publishedAt: null })
    const fields = await publicationFields('n1', 'published')
    expect(fields.publishedAt).toBeInstanceOf(Date)
    expect(mockPrisma.newsletter.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { slug: 'week-42-2026' } })
  })

  it('dates an issue that was already emailed by its first live send', async () => {
    mockPrisma.newsletter.findUnique.mockResolvedValue({ id: 'n1', title: 'Week 41, 2026', slug: 'week-41-2026', publishedAt: null })
    mockPrisma.newsletterSend.findMany.mockResolvedValue([
      { sentAt: new Date('2026-10-11T07:00:00Z'), createdAt: new Date('2026-10-11T07:00:00Z') },
      { sentAt: null, createdAt: new Date('2026-10-10T18:00:00Z') }, // scheduled: no sentAt of its own
    ])
    expect(await publicationFields('n1', 'published')).toEqual({ publishedAt: new Date('2026-10-10T18:00:00Z') })
    expect(mockPrisma.newsletterSend.findMany).toHaveBeenCalledWith({
      where: { newsletterId: 'n1', isTest: false, status: { not: 'failed' } },
      select: { sentAt: true, createdAt: true },
    })
  })

  it('keeps the first publication date when an issue is published again', async () => {
    mockPrisma.newsletter.findUnique.mockResolvedValue({ id: 'n1', title: 'W', slug: 'w', publishedAt: new Date('2026-10-01') })
    expect(await publicationFields('n1', 'published')).toEqual({})
  })

  it('changes nothing for other updates, unpublishing included', async () => {
    expect(await publicationFields('n1', 'draft')).toEqual({})
    expect(await publicationFields('n1', undefined)).toEqual({})
    expect(mockPrisma.newsletter.findUnique).not.toHaveBeenCalled()
  })
})

describe('toWebMarkdown', () => {
  it("drops the email template's favicon and section-color markers", () => {
    const md = '# Human Development {human-development}\n\n## Title\n{feed:abc-123} Publisher · [original article](https://x)\n'
    expect(toWebMarkdown(md)).toBe('# Human Development\n\n## Title\nPublisher · [original article](https://x)\n')
  })
})
