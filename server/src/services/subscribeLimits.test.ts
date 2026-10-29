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
  jobRun: {
    findUnique: vi.fn(),
  },
}))
const mockNotify = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))

const { config } = await import('../config.js')
const limits = await import('./subscribeLimits.js')

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** The module, with its once-per-hour alert throttles starting clean. */
async function loadModule() {
  limits._resetAlertThrottles()
  return limits
}

interface JobRow {
  enabled: boolean
  lastCompletedAt: Date | null
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS)

/** The send_queued_confirmations job as it normally is: enabled, and its last run a few minutes ago. */
const runningJob = (): JobRow => ({ enabled: true, lastCompletedAt: minutesAgo(5) })

/**
 * What the database holds, as the limits ask for it: rows for the address, waiting signups, sends in
 * the last hour, and the send_queued_confirmations job's row (null: there is none).
 */
function given({
  addressRow = false,
  waiting = 0,
  sentLastHour = 0,
  job = runningJob(),
}: {
  addressRow?: boolean
  waiting?: number
  sentLastHour?: number
  job?: JobRow | null
}) {
  const isWaitingQuery = (where: Where) => where.sentAt === null
  mockPrisma.pendingSubscription.findFirst.mockImplementation(async ({ where }: { where: Where }) => {
    if (where.email) return addressRow ? { id: 'p1' } : null
    if (isWaitingQuery(where)) return waiting > 0 ? { id: 'q1' } : null
    throw new Error(`unexpected findFirst: ${JSON.stringify(where)}`)
  })
  mockPrisma.pendingSubscription.count.mockImplementation(async ({ where }: { where: Where }) => (isWaitingQuery(where) ? waiting : sentLastHour))
  mockPrisma.jobRun.findUnique.mockResolvedValue(job)
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
    expect(mockPrisma.jobRun.findUnique).not.toHaveBeenCalled()
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

  it('queues behind earlier signups still waiting, even with room in the hour, without an alert while the job runs', async () => {
    given({ sentLastHour: 0, waiting: 1 })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('queue')
    const waitingQuery = mockPrisma.pendingSubscription.findFirst.mock.calls.find(([{ where }]) => where.sentAt === null)
    expect(waitingQuery?.[0].where.expiresAt.gt.getTime()).toBe(Date.now())
    expect(mockPrisma.jobRun.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { jobName: 'send_queued_confirmations' } }))
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('raises no alert while the job last completed a run just inside the stall limit', async () => {
    given({ waiting: 1, job: { enabled: true, lastCompletedAt: minutesAgo(config.subscribe.queueStalledAfterMinutes - 1) } })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('queue')
    expect(mockNotify).not.toHaveBeenCalled()
  })

  describe('when signups queue behind waiting ones but nothing sends them', () => {
    // Rows and texts are built inside the test, on its fake clock
    it.each<[string, () => JobRow | null, () => string]>([
      ['is disabled', () => ({ enabled: false, lastCompletedAt: minutesAgo(5) }), () => 'send_queued_confirmations is disabled'],
      [
        'has not completed a run within the stall limit',
        () => ({ enabled: true, lastCompletedAt: minutesAgo(config.subscribe.queueStalledAfterMinutes + 1) }),
        () => `send_queued_confirmations has not completed a run since ${minutesAgo(config.subscribe.queueStalledAfterMinutes + 1).toISOString()}`,
      ],
      ['has never completed a run', () => ({ enabled: true, lastCompletedAt: null }), () => 'send_queued_confirmations has never completed a run'],
      ['has no job row', () => null, () => 'send_queued_confirmations has no job row'],
    ])('still queues the signup, and warns the owner once that the job %s, without the address', async (_label, job, expected) => {
      given({ waiting: 2, job: job() })
      const { checkSendAllowance } = await loadModule()

      expect(await checkSendAllowance('victim@example.com')).toBe('queue')

      expect(mockNotify).toHaveBeenCalledTimes(1)
      const notice = mockNotify.mock.calls[0][0]
      expect(notice).toMatchObject({ source: 'subscriptions', severity: 'warning', dedupeKey: 'signup-queue-stalled', link: '/admin/jobs' })
      expect(notice.message).toContain(expected())
      expect(notice.message).toMatch(/\b2 waiting/)
      expect(JSON.stringify(mockNotify.mock.calls)).not.toContain('victim@example.com')
    })

    it('warns at most once an hour, and again after it', async () => {
      given({ waiting: 1, job: { enabled: false, lastCompletedAt: null } })
      const { checkSendAllowance } = await loadModule()

      await checkSendAllowance('a@example.com')
      vi.setSystemTime(Date.now() + 30 * MINUTE_MS)
      expect(await checkSendAllowance('b@example.com')).toBe('queue')
      expect(mockNotify).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + HOUR_MS)
      await checkSendAllowance('c@example.com')
      expect(mockNotify).toHaveBeenCalledTimes(2)
    })
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
