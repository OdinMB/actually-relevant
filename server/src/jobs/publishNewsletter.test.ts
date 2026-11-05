/**
 * The newer-coverage notice of the weekly send (the rest of the run is tested against PostgreSQL in
 * publishNewsletter.db.test.ts): advisory, after the send, never in its way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({ newsletter: { findFirst: vi.fn() } }))
const mockLifecycle = vi.hoisted(() => ({ sendLive: vi.fn() }))
const mockNotify = vi.hoisted(() => ({ notify: vi.fn() }))
const mockFreshness = vi.hoisted(() => ({ findNewerCoverage: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => mockNotify)
vi.mock('../services/storyFreshness.js', () => mockFreshness)
vi.mock('../services/newsletterLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/newsletterLifecycle.js')>()),
  ...mockLifecycle,
}))

const { runPublishNewsletter } = await import('./publishNewsletter.js')
const { NewsletterRefusedError } = await import('../services/newsletterLifecycle.js')

// Saturday 2026-02-21 04:30 UTC, ISO week 8
const SATURDAY = new Date('2026-02-21T04:30:00Z')
const ISSUE = { id: 'nl-1', title: 'Week 8, 2026', selectedStoryIds: ['s1', 's2', 's3', 's4'] }
const newer = (storyId: string) => ({
  storyId,
  newer: [{ id: `${storyId}-later`, title: 'Later', publisher: 'Feed', reportedAt: new Date(), reason: 'same_event' }],
})
const noticeTitles = () => mockNotify.notify.mock.calls.map(([input]) => input.title)

describe('runPublishNewsletter: newer coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.newsletter.findFirst.mockResolvedValue(ISSUE)
    mockLifecycle.sendLive.mockResolvedValue({})
    mockFreshness.findNewerCoverage.mockResolvedValue([])
  })

  it('after the send, raises one warning naming how many stories may be outdated, without their headlines', async () => {
    mockFreshness.findNewerCoverage.mockResolvedValue([newer('s1'), newer('s3')])

    await runPublishNewsletter(SATURDAY)

    expect(mockLifecycle.sendLive).toHaveBeenCalledWith('nl-1')
    expect(mockFreshness.findNewerCoverage).toHaveBeenCalledWith(['s1', 's2', 's3', 's4'])
    expect(mockLifecycle.sendLive.mock.invocationCallOrder[0]).toBeLessThan(mockFreshness.findNewerCoverage.mock.invocationCallOrder[0]!)
    expect(noticeTitles()).toEqual(['Newsletter sent', 'Newsletter stories may be outdated'])
    const warning = mockNotify.notify.mock.calls[1]![0]
    expect(warning).toEqual({
      source: 'newsletter',
      severity: 'warning',
      title: 'Newsletter stories may be outdated',
      message: expect.stringContaining('Week 8, 2026 (2026-W08) went out with 2 of 4 stories'),
      link: '/admin/newsletters/nl-1',
      dedupeKey: 'newsletter-newer-coverage:2026-W08',
    })
    expect(warning.message).not.toContain('Later')
  })

  it('raises nothing more when no story has newer coverage', async () => {
    await runPublishNewsletter(SATURDAY)
    expect(noticeTitles()).toEqual(['Newsletter sent'])
  })

  it('still sends, and the run still succeeds, when the check fails', async () => {
    mockFreshness.findNewerCoverage.mockRejectedValue(new Error('connection lost'))

    await expect(runPublishNewsletter(SATURDAY)).resolves.toBeUndefined()

    expect(mockLifecycle.sendLive).toHaveBeenCalledWith('nl-1')
    expect(noticeTitles()).toEqual(['Newsletter sent'])
  })

  it('checks nothing when the send was refused or failed', async () => {
    mockLifecycle.sendLive.mockRejectedValueOnce(new NewsletterRefusedError('no_current_test', 'no test'))
    await runPublishNewsletter(SATURDAY)

    mockLifecycle.sendLive.mockRejectedValueOnce(new Error('Plunk 500'))
    await expect(runPublishNewsletter(SATURDAY)).rejects.toThrow('Plunk 500')

    expect(mockFreshness.findNewerCoverage).not.toHaveBeenCalled()
    expect(noticeTitles()).toEqual(['Newsletter not sent'])
  })
})
