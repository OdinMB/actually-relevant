import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  jobRun: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}))
const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), warn: mockWarn, error: vi.fn() }) }))

const { claimJobRun, withJobLeaseHeartbeat, finishJobRun, jobsWithLiveLease, releaseHeldJobLeases, LEASE_HOLDER } =
  await import('./jobLease.js')
const { config } = await import('../config.js')

/** The SQL text and the bound values of the n-th raw statement. */
function rawCall(n: number): { sql: string; values: unknown[] } {
  const [strings, ...values] = mockPrisma.$executeRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]]
  return { sql: strings.join('?'), values }
}

describe('job lease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.$executeRaw.mockReset().mockResolvedValue(1)
    mockPrisma.jobRun.findUnique.mockReset()
  })

  describe('claimJobRun', () => {
    it('claims and starts the run in one conditional statement fenced on an expired or absent lease', async () => {
      await expect(claimJobRun('crawl_feeds')).resolves.toBe('claimed')

      const { sql, values } = rawCall(0)
      expect(sql).toContain('"last_started_at"')
      expect(sql).toContain('"locked_until" IS NULL OR "locked_until" <')
      expect(values).toContain('crawl_feeds')
      expect(values).toContain(LEASE_HOLDER)
      expect(mockPrisma.jobRun.findUnique).not.toHaveBeenCalled()
    })

    it("reports 'held' when another process's lease is live", async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(0)
      mockPrisma.jobRun.findUnique.mockResolvedValueOnce({ id: 'row-1' })

      await expect(claimJobRun('crawl_feeds')).resolves.toBe('held')
    })

    it('throws when the job has no row', async () => {
      mockPrisma.$executeRaw.mockResolvedValueOnce(0)
      mockPrisma.jobRun.findUnique.mockResolvedValueOnce(null)

      await expect(claimJobRun('crawl_feeds')).rejects.toThrow('crawl_feeds')
    })
  })

  describe('withJobLeaseHeartbeat', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('renews the lease every leaseRenewMs while the work is pending, and stops after', async () => {
      let finish: () => void = () => {}
      const run = withJobLeaseHeartbeat('assess_stories', () => new Promise<void>(resolve => { finish = resolve }))

      await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 3)
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3)
      const { sql, values } = rawCall(0)
      expect(sql).toContain('"locked_by" =')
      expect(values).toEqual(expect.arrayContaining(['assess_stories', LEASE_HOLDER]))

      finish()
      await run
      await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 3)
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(3)
    })

    it('warns once and stops renewing when the lease was lost, and the work still completes', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0)
      let finish: (value: string) => void = () => {}
      const run = withJobLeaseHeartbeat('assess_stories', () => new Promise<string>(resolve => { finish = resolve }))

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
      const run = withJobLeaseHeartbeat('assess_stories', () => new Promise<void>(resolve => { finish = resolve }))

      await vi.advanceTimersByTimeAsync(config.scheduler.leaseRenewMs * 2)
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
      finish()
      await run
    })
  })

  describe('finishJobRun', () => {
    it('on success records completion and success and releases only its own lease', async () => {
      await finishJobRun('crawl_feeds', null)

      const { sql, values } = rawCall(0)
      expect(sql).toContain('"last_completed_at"')
      expect(sql).toContain('CASE WHEN "locked_by" =')
      expect(values).toEqual(expect.arrayContaining(['crawl_feeds', LEASE_HOLDER, true]))
      expect(values).not.toContain(false)
    })

    it('on failure records the error without marking a success', async () => {
      await finishJobRun('crawl_feeds', 'boom')

      const { values } = rawCall(0)
      expect(values).toEqual(expect.arrayContaining(['crawl_feeds', LEASE_HOLDER, false, 'boom']))
      expect(values).not.toContain(true)
    })
  })

  it('jobsWithLiveLease returns the names the database reports with a live lease', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ job_name: 'crawl_feeds' }])
    await expect(jobsWithLiveLease()).resolves.toEqual(new Set(['crawl_feeds']))
  })

  it('releaseHeldJobLeases clears only the leases this process holds', async () => {
    mockPrisma.$executeRaw.mockResolvedValueOnce(2)

    await expect(releaseHeldJobLeases()).resolves.toBe(2)
    const { sql, values } = rawCall(0)
    expect(sql).toContain('WHERE "locked_by" =')
    expect(values).toEqual([LEASE_HOLDER])
  })
})
