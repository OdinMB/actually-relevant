import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface Where {
  sentAt?: unknown
  confirmedAt?: unknown
}

const mockPrisma = vi.hoisted(() => ({
  pendingSubscription: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const mockPlunk = vi.hoisted(() => ({ sendTransactional: vi.fn() }))
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../services/plunk.js', () => mockPlunk)
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }))

const { config } = await import('../config.js')
const { runSendQueuedConfirmations } = await import('./sendQueuedConfirmations.js')

const HOUR_MS = 60 * 60 * 1000
const NOW = new Date('2026-10-29T12:00:00Z')

const SIGNED_UP = new Date(NOW.getTime() - 2 * HOUR_MS)
const waiting = [
  { id: 'q1', email: 'first@example.com', token: 'token-1', createdAt: SIGNED_UP, expiresAt: new Date(NOW.getTime() + 2 * HOUR_MS) },
  { id: 'q2', email: 'second@example.com', token: 'token-2', createdAt: SIGNED_UP, expiresAt: new Date(NOW.getTime() + 3 * HOUR_MS) },
]

/**
 * The database as the job reads it: sends in the last hour, the waiting signups, and confirmed rows
 * elsewhere for their addresses, confirmed now (after the signups) unless `at` says when.
 */
function given({ sentLastHour = 0, rows = waiting, confirmed = [] as { email: string; at?: Date }[] } = {}) {
  mockPrisma.pendingSubscription.count.mockResolvedValue(sentLastHour)
  mockPrisma.pendingSubscription.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    where.sentAt === null ? rows : confirmed.map(({ email, at = NOW }) => ({ email, confirmedAt: at })),
  )
}

const allLogged = () => JSON.stringify([mockLogger.info, mockLogger.warn, mockLogger.error, mockLogger.debug].flatMap(fn => fn.mock.calls))
const notConnected = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })
const timedOut = () => Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
const plunkAnswered = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } })

/** The updateMany calls that put a signup back in the queue (its claim undone). */
const putBacks = () => mockPrisma.pendingSubscription.updateMany.mock.calls.filter(([{ data }]) => data.sentAt === null)

describe('runSendQueuedConfirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    config.subscribe.enabled = true
    given()
    mockPrisma.pendingSubscription.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.pendingSubscription.updateMany.mockResolvedValue({ count: 1 })
    mockPlunk.sendTransactional.mockResolvedValue(undefined)
    mockNotify.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    config.subscribe.enabled = false
  })

  it('sends nothing, touches no row and logs only at debug level while signups are paused', async () => {
    config.subscribe.enabled = false

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect(mockLogger.info).not.toHaveBeenCalled()
    expect(mockLogger.debug).toHaveBeenCalled()
  })

  it('sends each waiting signup its own confirmation link and gives the link a full lifetime from now', async () => {
    await runSendQueuedConfirmations()

    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(2)
    const first = mockPlunk.sendTransactional.mock.calls[0][0]
    expect(first.to).toBe('first@example.com')
    expect(first.body).toContain('token=token-1')
    expect(first.body).toContain('email=first%40example.com')
    const claim = mockPrisma.pendingSubscription.updateMany.mock.calls[0][0]
    expect(claim.where).toEqual({ id: 'q1', sentAt: null })
    expect(claim.data.sentAt.getTime()).toBe(NOW.getTime())
    expect(claim.data.expiresAt.getTime()).toBe(NOW.getTime() + config.subscribe.confirmTokenExpiryHours * HOUR_MS)
  })

  it('asks for no more waiting signups than the hour has room for', async () => {
    given({ sentLastHour: config.subscribe.globalHourlyMax - 1 })

    await runSendQueuedConfirmations()

    const query = mockPrisma.pendingSubscription.findMany.mock.calls[0][0]
    expect(query.take).toBe(1)
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
  })

  it('reads no waiting signup when the hour is full', async () => {
    given({ sentLastHour: config.subscribe.globalHourlyMax })

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.findMany).not.toHaveBeenCalled()
    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
  })

  it('does not send a signup it could not claim (removed or sent meanwhile)', async () => {
    mockPrisma.pendingSubscription.updateMany.mockResolvedValueOnce({ count: 0 })

    await runSendQueuedConfirmations()

    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    expect(mockPlunk.sendTransactional.mock.calls[0][0].to).toBe('second@example.com')
  })

  it('removes a waiting signup whose address confirmed meanwhile, without sending it', async () => {
    given({ confirmed: [{ email: 'first@example.com' }] })

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'q1', sentAt: null } })
    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    expect(mockPlunk.sendTransactional.mock.calls[0][0].to).toBe('second@example.com')
  })

  it('sends a waiting signup whose address confirmed only before it signed up (a returning reader)', async () => {
    given({ confirmed: [{ email: 'first@example.com', at: new Date(SIGNED_UP.getTime() - 30 * 24 * HOUR_MS) }] })

    await runSendQueuedConfirmations()

    expect(mockPlunk.sendTransactional.mock.calls.map(([opts]) => opts.to)).toEqual(['first@example.com', 'second@example.com'])
    expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledTimes(1) // the expiry sweep only
  })

  it('removes the waiting signup of a returning reader who confirmed again after it, going by the latest confirmation', async () => {
    given({ confirmed: [{ email: 'first@example.com', at: new Date(SIGNED_UP.getTime() - 30 * 24 * HOUR_MS) }, { email: 'first@example.com' }] })

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'q1', sentAt: null } })
    expect(mockPlunk.sendTransactional.mock.calls.map(([opts]) => opts.to)).toEqual(['second@example.com'])
  })

  describe('signups that waited past their expiry', () => {
    it('removes them and tells the owner how many, in one notice that a repeat reopens, without an address', async () => {
      mockPrisma.pendingSubscription.deleteMany.mockResolvedValueOnce({ count: 3 })

      await runSendQueuedConfirmations()

      expect(mockPrisma.pendingSubscription.deleteMany.mock.calls[0][0].where).toEqual({ sentAt: null, confirmedAt: null, expiresAt: { lte: NOW } })
      expect(mockNotify).toHaveBeenCalledTimes(1)
      const notice = mockNotify.mock.calls[0][0]
      expect(notice).toMatchObject({ source: 'subscriptions', severity: 'warning', dedupeKey: 'signup-queue-expired', link: '/admin/subscribers' })
      expect(notice.message).toMatch(/^3 queued signups /)
      expect(notice.message).toContain(`${config.subscribe.confirmTokenExpiryHours} hours`)
      expect(JSON.stringify(mockNotify.mock.calls)).not.toMatch(/@example\.com/)
    })

    it('raises no notice when none expired', async () => {
      await runSendQueuedConfirmations()

      expect(mockNotify).not.toHaveBeenCalled()
    })
  })

  describe('when a send fails', () => {
    it('puts a signup back in the queue when Plunk certainly got nothing, and fails the run without the address', async () => {
      mockPlunk.sendTransactional.mockRejectedValueOnce(notConnected())

      const run = runSendQueuedConfirmations()

      await expect(run).rejects.toThrow(/queued confirmation email/i)
      await run.catch((err: Error) => expect(err.message).not.toContain('first@example.com'))
      expect(mockPrisma.pendingSubscription.updateMany).toHaveBeenCalledTimes(2)
      expect(mockPrisma.pendingSubscription.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 'q1' },
        data: { sentAt: null, expiresAt: waiting[0].expiresAt },
      })
      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    })

    // 401, 403 (PROJECT_DISABLED) and 429 are about the account or the rate, not this address:
    // every later signup would get the same answer, so they wait for the next run.
    it.each([401, 403, 404, 409, 429])('puts the signup back and stops the run on a %i from Plunk', async status => {
      mockPlunk.sendTransactional.mockRejectedValueOnce(plunkAnswered(status))

      await expect(runSendQueuedConfirmations()).rejects.toThrow(/queued confirmation email failed to send/i)

      expect(putBacks()).toHaveLength(1)
      expect(putBacks()[0][0].where).toEqual({ id: 'q1' })
      expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledTimes(1) // the expiry sweep only
      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['a timeout', timedOut],
      ['a 500', () => plunkAnswered(500)],
      ['a 503', () => plunkAnswered(503)],
    ])('never sends a signup again after %s, when Plunk may have accepted it, and stops the run', async (_label, failure) => {
      mockPlunk.sendTransactional.mockRejectedValueOnce(failure())

      await expect(runSendQueuedConfirmations()).rejects.toThrow(/queued confirmation email/i)

      expect(mockPrisma.pendingSubscription.updateMany).toHaveBeenCalledTimes(1)
      expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledTimes(1) // the expiry sweep only
      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    })
  })

  describe('when Plunk refuses one signup as invalid', () => {
    it.each([400, 422])('removes the signup refused with a %i unsent, sends the next, then fails the run naming the count and status', async status => {
      mockPlunk.sendTransactional.mockRejectedValueOnce(plunkAnswered(status))

      await expect(runSendQueuedConfirmations()).rejects.toThrow(`1 queued signup refused by Plunk (HTTP ${status}) and removed`)

      expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'q1' } })
      expect(putBacks()).toHaveLength(0)
      expect(mockPlunk.sendTransactional.mock.calls.map(([opts]) => opts.to)).toEqual(['first@example.com', 'second@example.com'])
      expect(mockLogger.warn).toHaveBeenCalledWith({ subscriptionId: 'q1', status }, expect.any(String))
    })

    it('counts every refused signup, with each status once, in the one failure', async () => {
      given({ rows: [...waiting, { id: 'q3', email: 'third@example.com', token: 'token-3', expiresAt: waiting[1].expiresAt }] })
      mockPlunk.sendTransactional.mockRejectedValueOnce(plunkAnswered(422)).mockRejectedValueOnce(plunkAnswered(400)).mockRejectedValueOnce(plunkAnswered(422))

      await expect(runSendQueuedConfirmations()).rejects.toThrow(/^3 queued signups refused by Plunk \(HTTP 400, 422\) and removed$/)

      expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(3)
    })

    it('names the refused signups too when a later send stops the run', async () => {
      mockPlunk.sendTransactional.mockRejectedValueOnce(plunkAnswered(422)).mockRejectedValueOnce(notConnected())

      const run = runSendQueuedConfirmations()

      await expect(run).rejects.toThrow(/queued confirmation email failed to send/i)
      await run.catch((err: Error) => expect(err.message).toContain('1 queued signup refused by Plunk (HTTP 422) and removed'))
      expect(putBacks().map(([{ where }]) => where)).toEqual([{ id: 'q2' }])
    })
  })

  it('logs no email address, whatever happens', async () => {
    given({ confirmed: [{ email: 'second@example.com' }] })
    await runSendQueuedConfirmations()
    given()
    mockPlunk.sendTransactional.mockRejectedValueOnce(timedOut())
    await runSendQueuedConfirmations().catch(() => {})
    mockPlunk.sendTransactional.mockRejectedValueOnce(notConnected())
    await runSendQueuedConfirmations().catch(() => {})
    mockPlunk.sendTransactional.mockRejectedValueOnce(plunkAnswered(422))
    await runSendQueuedConfirmations().catch(() => {})

    expect(mockLogger.info).toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalled()
    expect(allLogged()).not.toMatch(/(first|second)@example\.com/)
  })
})
