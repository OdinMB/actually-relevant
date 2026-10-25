import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The lease statements (claim, finish, live leases, release) run against PostgreSQL in
// jobLease.db.test.ts. This file covers the heartbeat's timing and its reaction to a lost lease,
// which fake timers make testable; the renewal statement's row count is all it needs from Prisma.
const mockPrisma = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
}))
const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn() }) }))

const { withJobLeaseHeartbeat, LEASE_HOLDER } = await import('./jobLease.js')
const { config } = await import('../config.js')

/** The SQL text and the bound values of the n-th raw statement. */
function rawCall(n: number): { sql: string; values: unknown[] } {
  const [strings, ...values] = mockPrisma.$executeRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]]
  return { sql: strings.join('?'), values }
}

describe('withJobLeaseHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockReset().mockResolvedValue(1)
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('renews the lease every leaseRenewMs while the work is pending, and stops after', async () => {
    let finish: () => void = () => {}
    const run = withJobLeaseHeartbeat(
      'assess_stories',
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )

    await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 3)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3)
    const { sql, values } = rawCall(0)
    expect(sql).toContain('"locked_by" =')
    expect(sql).toContain('make_interval(secs =>')
    expect(values).toEqual(expect.arrayContaining(['assess_stories', LEASE_HOLDER, config.scheduler.leaseSeconds]))

    finish()
    await run
    await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 3)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3)
  })

  it('renews at every renewal tick and never earlier, so a lease gets several renewals before it can expire', async () => {
    let finish: () => void = () => {}
    const run = withJobLeaseHeartbeat(
      'crawl_feeds',
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )

    await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs - 1)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1)

    // Within one lease period after the claim, every renewal tick has fired.
    await vi.advanceTimersByTimeAsync(config.scheduler.leaseSeconds * 1000 - config.scheduler.leaseRenewMs)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(Math.floor((config.scheduler.leaseSeconds * 1000) / config.scheduler.leaseRenewMs))

    finish()
    await run
  })

  it('warns once and stops renewing when the lease was lost, and the work still completes', async () => {
    mockPrisma.$executeRaw.mockResolvedValue(0)
    let finish: (value: string) => void = () => {}
    const run = withJobLeaseHeartbeat(
      'assess_stories',
      () =>
        new Promise<string>(resolve => {
          finish = resolve
        }),
    )

    await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 4)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith({ jobName: 'assess_stories' }, 'lost the job lease')

    finish('done')
    await expect(run).resolves.toBe('done')
  })

  it('a failed renewal write is logged and renewal goes on', async () => {
    mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('db blip')).mockResolvedValue(1)
    let finish: () => void = () => {}
    const run = withJobLeaseHeartbeat(
      'assess_stories',
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        }),
    )

    await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 2)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
    finish()
    await run
  })
})
