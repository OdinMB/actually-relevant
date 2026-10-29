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

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../services/plunk.js', () => mockPlunk)
vi.mock('../lib/notify.js', () => ({ notify: vi.fn() }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }))

const { config } = await import('../config.js')
const { runSendQueuedConfirmations } = await import('./sendQueuedConfirmations.js')

const HOUR_MS = 60 * 60 * 1000
const NOW = new Date('2026-10-29T12:00:00Z')

const waiting = [
  { id: 'q1', email: 'first@example.com', token: 'token-1', expiresAt: new Date(NOW.getTime() + 2 * HOUR_MS) },
  { id: 'q2', email: 'second@example.com', token: 'token-2', expiresAt: new Date(NOW.getTime() + 3 * HOUR_MS) },
]

/** The database as the job reads it: sends in the last hour, the waiting signups, addresses confirmed elsewhere. */
function given({ sentLastHour = 0, rows = waiting, confirmed = [] as string[] } = {}) {
  mockPrisma.pendingSubscription.count.mockResolvedValue(sentLastHour)
  mockPrisma.pendingSubscription.findMany.mockImplementation(async ({ where }: { where: Where }) =>
    where.sentAt === null ? rows : confirmed.map(email => ({ email })),
  )
}

const allLogged = () => JSON.stringify([mockLogger.info, mockLogger.warn, mockLogger.error, mockLogger.debug].flatMap(fn => fn.mock.calls))
const notConnected = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })
const timedOut = () => Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })

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
  })

  afterEach(() => {
    vi.useRealTimers()
    config.subscribe.enabled = false
  })

  it('sends nothing and touches no row while signups are paused', async () => {
    config.subscribe.enabled = false

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.pendingSubscription.deleteMany).not.toHaveBeenCalled()
    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
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
    given({ confirmed: ['first@example.com'] })

    await runSendQueuedConfirmations()

    expect(mockPrisma.pendingSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'q1', sentAt: null } })
    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    expect(mockPlunk.sendTransactional.mock.calls[0][0].to).toBe('second@example.com')
  })

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

  it('treats a 4xx answer as nothing sent', async () => {
    mockPlunk.sendTransactional.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }))

    await expect(runSendQueuedConfirmations()).rejects.toThrow()

    expect(mockPrisma.pendingSubscription.updateMany.mock.calls[1][0].data.sentAt).toBeNull()
  })

  it('never sends a signup again when Plunk may have accepted it, and stops the run', async () => {
    mockPlunk.sendTransactional.mockRejectedValueOnce(timedOut())

    await expect(runSendQueuedConfirmations()).rejects.toThrow(/queued confirmation email/i)

    expect(mockPrisma.pendingSubscription.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
  })

  it('logs no email address, whatever happens', async () => {
    given({ confirmed: ['second@example.com'] })
    await runSendQueuedConfirmations()
    given()
    mockPlunk.sendTransactional.mockRejectedValueOnce(timedOut())
    await runSendQueuedConfirmations().catch(() => {})
    mockPlunk.sendTransactional.mockRejectedValueOnce(notConnected())
    await runSendQueuedConfirmations().catch(() => {})

    expect(mockLogger.info).toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalled()
    expect(allLogged()).not.toMatch(/(first|second)@example\.com/)
  })
})
