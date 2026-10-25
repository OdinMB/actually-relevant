import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.hoisted(() => vi.fn())
const mockSendLive = vi.hoisted(() => vi.fn())
const mockUpdateNewsletter = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())
const mockConfig = vi.hoisted(() => ({ plunk: { secretKey: 'sk' } }))

vi.mock('../lib/prisma.js', () => ({ default: { newsletter: { findFirst: mockFindFirst } } }))
vi.mock('../config.js', () => ({ config: mockConfig }))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('../services/newsletter.js', () => ({ sendLive: mockSendLive, updateNewsletter: mockUpdateNewsletter }))
vi.mock('./generateNewsletter.js', () => ({ getWeekKey: () => '2026-W08' }))

const { runPublishNewsletter, newsletterSendProblem } = await import('./publishNewsletter.js')

// Saturday 2026-02-21 04:30 UTC, ISO week 8
const SATURDAY = new Date('2026-02-21T04:30:00Z')
const ISSUE = { id: 'nl-1', title: 'Week 8, 2026', sends: [{ id: 'send-test' }] }

describe('runPublishNewsletter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockConfig.plunk.secretKey = 'sk'
  })

  it('sends this week\'s built draft to all subscribers, then marks it published and notifies', async () => {
    mockFindFirst.mockResolvedValueOnce(ISSUE)

    await runPublishNewsletter(SATURDAY)

    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { weekKey: '2026-W08', html: { not: '' }, status: 'draft', sends: { none: { isTest: false } } },
    }))
    expect(mockSendLive).toHaveBeenCalledWith('nl-1')
    expect(mockUpdateNewsletter).toHaveBeenCalledWith('nl-1', { status: 'published' })
    expect(mockSendLive.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateNewsletter.mock.invocationCallOrder[0])
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      source: 'newsletter', severity: 'info', message: expect.stringContaining('Week 8, 2026'),
    }))
  })

  it('does not send an issue without a successful test send, and warns once per week', async () => {
    mockFindFirst.mockResolvedValueOnce({ ...ISSUE, sends: [] })

    await runPublishNewsletter(SATURDAY)

    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ sends: expect.objectContaining({ where: { isTest: true } }) }),
    }))
    expect(mockSendLive).not.toHaveBeenCalled()
    expect(mockUpdateNewsletter).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      source: 'newsletter', severity: 'warning', dedupeKey: 'newsletter-not-sent:2026-W08', message: expect.stringContaining('no successful test email'),
    }))
  })

  it('does nothing quietly when no issue exists this week (generate_newsletter already alerted)', async () => {
    mockFindFirst.mockResolvedValue(null)

    await runPublishNewsletter(SATURDAY)

    expect(mockSendLive).not.toHaveBeenCalled()
    expect(mockUpdateNewsletter).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('warns once per week when this week\'s issue is still being built', async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'nl-draft' })

    await runPublishNewsletter(SATURDAY)

    expect(mockFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { weekKey: '2026-W08', html: '' } }))
    expect(mockSendLive).not.toHaveBeenCalled()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      source: 'newsletter', severity: 'warning', dedupeKey: 'newsletter-not-sent:2026-W08',
    }))
  })

  it('fails the run without marking the issue published when the send fails', async () => {
    mockFindFirst.mockResolvedValueOnce(ISSUE)
    mockSendLive.mockRejectedValueOnce(new Error('Plunk down'))

    await expect(runPublishNewsletter(SATURDAY)).rejects.toThrow('Plunk down')
    expect(mockUpdateNewsletter).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

describe('newsletterSendProblem', () => {
  it('names PLUNK_SECRET_KEY when it is missing, and is null once it is set', () => {
    mockConfig.plunk.secretKey = ''
    expect(newsletterSendProblem()).toContain('PLUNK_SECRET_KEY')
    mockConfig.plunk.secretKey = 'sk'
    expect(newsletterSendProblem()).toBeNull()
  })
})
