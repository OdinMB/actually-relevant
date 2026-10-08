import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListActivity = vi.hoisted(() => vi.fn())
const mockNotify = vi.hoisted(() => vi.fn())
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../services/plunk.js', () => ({ listActivity: mockListActivity }))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLog }))

const { runPollPlunkActivity, activityNotice } = await import('./pollPlunkActivity.js')
const { config } = await import('../config.js')

const NOW = new Date('2026-10-08T12:20:00Z')
const DAY = 24 * 60 * 60 * 1000
const ADDRESS = 'victim@example.com'

/** An item as Plunk returns it, personal data included, so the test can show none of it survives. */
const activity = (id: string, type: string, metadata: Record<string, unknown> = {}) => ({
  id,
  type,
  timestamp: '2026-10-07T09:00:00.000Z',
  contactEmail: ADDRESS,
  contactId: 'contact-123',
  metadata: {
    subject: 'Week 41, 2026',
    campaignName: 'Week 41 newsletter',
    sourceType: 'CAMPAIGN',
    body: `<p>Hello ${ADDRESS}</p>`,
    error: `550 5.1.1 <${ADDRESS}>: Recipient address rejected`,
    ...metadata,
  },
})

const page = (items: unknown[], more?: { cursor: string }) =>
  ({ items, nextCursor: more?.cursor ?? null, hasMore: Boolean(more) })

describe('runPollPlunkActivity', () => {
  const savedKey = config.plunk.secretKey

  beforeEach(() => {
    vi.clearAllMocks()
    config.plunk.secretKey = 'sk_test'
    mockListActivity.mockResolvedValue(page([]))
  })

  afterEach(() => {
    config.plunk.secretKey = savedKey
  })

  it('makes no call without a secret key', async () => {
    config.plunk.secretKey = ''
    await runPollPlunkActivity(NOW)
    expect(mockListActivity).not.toHaveBeenCalled()
  })

  it('reads the trailing lookback window on every run, for complaints and bounces', async () => {
    await runPollPlunkActivity(NOW)
    await runPollPlunkActivity(NOW)
    for (const [opts] of mockListActivity.mock.calls) {
      expect(opts.startDate).toEqual(new Date(NOW.getTime() - config.plunk.activityLookbackDays * DAY))
      expect(opts.types).toEqual(['email.complaint', 'email.bounced'])
    }
  })

  it('pages by cursor until hasMore is false', async () => {
    mockListActivity
      .mockResolvedValueOnce(page([activity('e1_complaint', 'email.complaint')], { cursor: 'c2' }))
      .mockResolvedValueOnce(page([activity('e2_bounce', 'email.bounced')]))
    await runPollPlunkActivity(NOW)
    expect(mockListActivity).toHaveBeenCalledTimes(2)
    expect(mockListActivity.mock.calls[1][0].cursor).toBe('c2')
    expect(mockNotify).toHaveBeenCalledTimes(2)
  })

  it('fails the run at the page limit, keeping the notices already recorded', async () => {
    mockListActivity.mockResolvedValue(page([activity('e1_complaint', 'email.complaint')], { cursor: 'again' }))
    await expect(runPollPlunkActivity(NOW)).rejects.toThrow(/page limit/)
    expect(mockListActivity).toHaveBeenCalledTimes(config.plunk.activityMaxPages)
    expect(mockNotify).toHaveBeenCalledTimes(config.plunk.activityMaxPages)
  })

  it('records every event insert-only, keyed by its activity id', async () => {
    mockListActivity.mockResolvedValueOnce(page([activity('e1_complaint', 'email.complaint'), activity('e2_bounce', 'email.bounced')]))
    await runPollPlunkActivity(NOW)
    for (const [, options] of mockNotify.mock.calls) expect(options).toEqual({ reopen: false })
    expect(mockNotify.mock.calls.map(([n]) => n.dedupeKey)).toEqual(['plunk:e1_complaint', 'plunk:e2_bounce'])
  })

  it('makes a complaint critical and a bounce a warning', async () => {
    mockListActivity.mockResolvedValueOnce(page([activity('e1_complaint', 'email.complaint'), activity('e2_bounce', 'email.bounced')]))
    await runPollPlunkActivity(NOW)
    expect(mockNotify.mock.calls.map(([n]) => [n.source, n.severity])).toEqual([['plunk', 'critical'], ['plunk', 'warning']])
  })

  it('keeps no address, contact id, body or bounce error in what it records', async () => {
    mockListActivity.mockResolvedValueOnce(page([activity('e1_complaint', 'email.complaint'), activity('e2_bounce', 'email.bounced')]))
    await runPollPlunkActivity(NOW)
    const recorded = JSON.stringify(mockNotify.mock.calls)
    expect(recorded).not.toContain(ADDRESS)
    expect(recorded).not.toContain('contact-123')
    expect(recorded).not.toContain('Recipient address rejected')
    expect(recorded).toContain('Week 41 newsletter')
  })

  it('fails the run when the response shape is not recognized', async () => {
    mockListActivity.mockRejectedValueOnce(new Error('unrecognized Plunk activity response shape'))
    await expect(runPollPlunkActivity(NOW)).rejects.toThrow(/unrecognized/)
  })
})

describe('activityNotice', () => {
  it('names a transactional email by its subject when it has no campaign', () => {
    const notice = activityNotice(activity('e3_complaint', 'email.complaint', { campaignName: null, sourceType: 'TRANSACTIONAL', subject: 'Confirm your subscription' }))
    expect(notice?.message).toContain('transactional: "Confirm your subscription"')
  })

  it('ignores a type it did not ask for', () => {
    expect(activityNotice(activity('e4_open', 'email.opened'))).toBeNull()
  })

  it('refuses an item without an id, which could not be recorded once', () => {
    expect(() => activityNotice({ ...activity('', 'email.complaint') })).toThrow(/without an id/)
  })
})
