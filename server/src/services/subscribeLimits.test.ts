import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

interface Where {
  email?: string
  sentAt?: unknown
}

const mockPrisma = vi.hoisted(() => ({
  pendingSubscription: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
}))
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))

const { config } = await import('../config.js')

const HOUR_MS = 60 * 60 * 1000

/** A fresh module per test, so the once-per-hour alert throttle starts clean. */
async function loadModule() {
  vi.resetModules()
  return import('./subscribeLimits.js')
}

/** What the database holds, as the limits ask for it: rows for the address, waiting signups, sends in the last hour. */
function given({ addressRow = false, waiting = 0, sentLastHour = 0 }: { addressRow?: boolean; waiting?: number; sentLastHour?: number }) {
  const isWaitingQuery = (where: Where) => where.sentAt === null
  mockPrisma.pendingSubscription.findFirst.mockImplementation(async ({ where }: { where: Where }) => {
    if (where.email) return addressRow ? { id: 'p1' } : null
    if (isWaitingQuery(where)) return waiting > 0 ? { id: 'q1' } : null
    throw new Error(`unexpected findFirst: ${JSON.stringify(where)}`)
  })
  mockPrisma.pendingSubscription.count.mockImplementation(async ({ where }: { where: Where }) => (isWaitingQuery(where) ? waiting : sentLastHour))
}

describe('checkSendAllowance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    given({})
    mockNotify.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows a send when the address has no recent row, the cap is not reached and nobody waits', async () => {
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('limits an address that got a confirmation email, or signed up, within the window', async () => {
    given({ addressRow: true })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
    const where = mockPrisma.pendingSubscription.findFirst.mock.calls[0][0].where
    const windowStart = Date.now() - config.subscribe.perAddressWindowHours * HOUR_MS
    expect(where.email).toBe('a@example.com')
    expect(where.confirmedAt).toBeNull()
    expect(where.OR.map((c: Record<string, { gt: Date }>) => Object.values(c)[0].gt.getTime())).toEqual([windowStart, windowStart])
    expect(where.OR.flatMap((c: object) => Object.keys(c)).sort()).toEqual(['createdAt', 'sentAt'])
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('still limits the address while the queue is full, before anything else', async () => {
    given({ addressRow: true, waiting: 5, sentLastHour: config.subscribe.globalHourlyMax })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('queues at the hourly cap and alerts the owner once, without the address', async () => {
    given({ sentLastHour: config.subscribe.globalHourlyMax, waiting: 4 })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('victim@example.com')).toBe('queue')
    const sentQuery = mockPrisma.pendingSubscription.count.mock.calls.find(([{ where }]) => where.sentAt !== null)
    expect(sentQuery?.[0].where.sentAt.gt.getTime()).toBe(Date.now() - HOUR_MS)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ source: 'subscriptions', severity: 'warning', dedupeKey: 'signup-cap' }))
    const { message } = mockNotify.mock.calls[0][0]
    expect(message).toMatch(/queue/i)
    expect(message).toMatch(/\b4 already waiting/)
    expect(message).not.toMatch(/refused/i)
    expect(JSON.stringify(mockNotify.mock.calls[0])).not.toContain('victim@example.com')
  })

  it('allows a send just below the cap when nobody waits', async () => {
    given({ sentLastHour: config.subscribe.globalHourlyMax - 1 })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('queues behind earlier signups still waiting, even with room in the hour, without an alert', async () => {
    given({ sentLastHour: 0, waiting: 1 })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('queue')
    const waitingQuery = mockPrisma.pendingSubscription.findFirst.mock.calls.find(([{ where }]) => where.sentAt === null)
    expect(waitingQuery?.[0].where.expiresAt.gt.getTime()).toBe(Date.now())
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('sends no second alert within the hour, and alerts again after it', async () => {
    given({ sentLastHour: config.subscribe.globalHourlyMax })
    const { checkSendAllowance } = await loadModule()

    await checkSendAllowance('a@example.com')
    vi.setSystemTime(Date.now() + 30 * 60 * 1000)
    expect(await checkSendAllowance('b@example.com')).toBe('queue')
    expect(mockNotify).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + HOUR_MS)
    await checkSendAllowance('c@example.com')
    expect(mockNotify).toHaveBeenCalledTimes(2)
  })
})

describe('remainingHourlyBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is the hourly limit minus the emails sent in the last hour, never below zero', async () => {
    const { remainingHourlyBudget } = await loadModule()
    const now = new Date('2026-10-08T12:00:00Z')

    given({ sentLastHour: 12 })
    expect(await remainingHourlyBudget(now)).toBe(config.subscribe.globalHourlyMax - 12)
    expect(mockPrisma.pendingSubscription.count.mock.calls[0][0].where.sentAt.gt.getTime()).toBe(now.getTime() - HOUR_MS)

    given({ sentLastHour: config.subscribe.globalHourlyMax + 3 })
    expect(await remainingHourlyBudget(now)).toBe(0)
  })
})
