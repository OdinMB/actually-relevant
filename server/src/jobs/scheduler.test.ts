import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSchedule = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })))
const mockValidate = vi.hoisted(() => vi.fn(() => true))

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

const mockLease = vi.hoisted(() => ({
  claimJobRun: vi.fn(),
  withJobLeaseHeartbeat: vi.fn(),
  finishJobRun: vi.fn(),
  jobsWithLiveLease: vi.fn(),
}))

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}))

const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRunCrawlFeeds = vi.hoisted(() => vi.fn())
const mockRunAssessStories = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/notify.js')>()),
  notify: mockNotify,
}))

/** The notice the scheduler sends for a failed run of `jobName` whose message matches `message`. */
const failureOf = (jobName: string, message: unknown) =>
  expect.objectContaining({ dedupeKey: `job-failure:${jobName}`, message })
vi.mock('./jobLease.js', () => mockLease)
vi.mock('./crawlFeeds.js', () => ({ runCrawlFeeds: mockRunCrawlFeeds }))
vi.mock('./preassessStories.js', () => ({ runPreassessStories: vi.fn() }))
vi.mock('./assessStories.js', () => ({ runAssessStories: mockRunAssessStories }))
vi.mock('./selectStories.js', () => ({ runSelectStories: vi.fn() }))

const { initScheduler, startScheduler, stopScheduler, reloadJob, runJob, runningJobs, isJobRunning, estimateCronIntervalMs } =
  await import('./scheduler.js')
const { config } = await import('../config.js')

const HOUR = 60 * 60 * 1000

const enabledCrawlJob = {
  jobName: 'crawl_feeds',
  enabled: true,
  cronExpression: '0 */6 * * *',
  lastCompletedAt: new Date(),
  lastStartedAt: null,
}

/** A row whose last finish is more than 2x its interval ago (overdue at boot). */
const overdueRow = (jobName: string) => ({ ...enabledCrawlJob, jobName, lastCompletedAt: new Date(Date.now() - 48 * HOUR) })

/** Let pending promise chains run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidate.mockReturnValue(true)
    mockSchedule.mockReturnValue({ stop: vi.fn() })
    mockNotify.mockResolvedValue(undefined)
    mockPrisma.jobRun.findMany.mockReset()
    mockPrisma.jobRun.findUnique.mockReset()
    mockLease.claimJobRun.mockReset().mockResolvedValue('claimed')
    mockLease.withJobLeaseHeartbeat.mockReset().mockImplementation((_jobName: string, fn: () => Promise<unknown>) => fn())
    mockLease.finishJobRun.mockReset().mockResolvedValue(undefined)
    mockLease.jobsWithLiveLease.mockReset().mockResolvedValue(new Set())
    mockRunCrawlFeeds.mockReset().mockResolvedValue(undefined)
    mockRunAssessStories.mockReset().mockResolvedValue(undefined)
    config.scheduler.enabled = true
    stopScheduler()
    runningJobs.clear()
  })

  describe('runJob under the job lease', () => {
    it('runs the handler under the lease heartbeat and records a success', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)

      await runJob('crawl_feeds', handler)

      expect(mockLease.claimJobRun).toHaveBeenCalledWith('crawl_feeds')
      expect(mockLease.withJobLeaseHeartbeat).toHaveBeenCalledWith('crawl_feeds', handler)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('crawl_feeds', null)
      expect(mockNotify).not.toHaveBeenCalled()
      expect(runningJobs.has('crawl_feeds')).toBe(false)
    })

    it('records the error, not a success, when the handler fails, and alerts', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await runJob('crawl_feeds', handler)

      expect(mockLease.finishJobRun).toHaveBeenCalledTimes(1)
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('crawl_feeds', 'handler boom')
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', 'handler boom'))
    })

    it('skips quietly while another process holds the lease: no handler, no record, no alert', async () => {
      mockLease.claimJobRun.mockResolvedValueOnce('held')
      const handler = vi.fn()

      await runJob('crawl_feeds', handler)

      expect(handler).not.toHaveBeenCalled()
      expect(mockLease.finishJobRun).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
      expect(runningJobs.has('crawl_feeds')).toBe(false)
    })

    it('treats a job with no row as a failure and alerts', async () => {
      mockLease.claimJobRun.mockRejectedValueOnce(new Error('job crawl_feeds has no job_runs row'))
      const handler = vi.fn()

      await runJob('crawl_feeds', handler)

      expect(handler).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', expect.stringContaining('no job_runs row')))
    })

    it('skips a second run in the same process without touching the database', async () => {
      runningJobs.add('crawl_feeds')
      await runJob('crawl_feeds', vi.fn())
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })
  })

  describe('runJob never rejects', () => {
    it('does not run the handler when the claim fails, and clears and alerts', async () => {
      mockLease.claimJobRun.mockRejectedValue(new Error('db down'))
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(handler).not.toHaveBeenCalled()
      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', expect.stringContaining('db down')))
    })

    it('resolves when the handler throws and the error-path write also fails', async () => {
      mockLease.finishJobRun.mockRejectedValueOnce(new Error('db gone'))
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', 'handler boom'))
    })

    it('treats a failed completion write as a job failure', async () => {
      mockLease.finishJobRun.mockRejectedValueOnce(new Error('completion write failed'))
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockLease.finishJobRun).toHaveBeenLastCalledWith('crawl_feeds', 'completion write failed')
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', 'completion write failed'))
    })

    it('a cron tick while every write fails produces no unhandled rejection', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledCrawlJob])
      await initScheduler()
      const tick = (mockSchedule.mock.calls[0] as unknown as [string, () => void])[1]

      mockLease.claimJobRun.mockRejectedValue(new Error('db down'))
      mockLease.finishJobRun.mockRejectedValue(new Error('db down'))
      const onUnhandled = vi.fn()
      process.on('unhandledRejection', onUnhandled)
      try {
        tick()
        // Let the launched promise chain and any rejection-tracking settle
        await new Promise(resolve => setTimeout(resolve, 20))
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }

      expect(onUnhandled).not.toHaveBeenCalled()
      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('crawl_feeds', expect.stringContaining('db down')))
    })
  })

  describe('isJobRunning', () => {
    it('is true for a run in this process, without asking the database', async () => {
      runningJobs.add('crawl_feeds')
      await expect(isJobRunning('crawl_feeds')).resolves.toBe(true)
      expect(mockLease.jobsWithLiveLease).not.toHaveBeenCalled()
    })

    it("is true while another process's lease on the job is live", async () => {
      mockLease.jobsWithLiveLease.mockResolvedValueOnce(new Set(['crawl_feeds']))
      await expect(isJobRunning('crawl_feeds')).resolves.toBe(true)
    })

    it('is false when no process runs it', async () => {
      mockLease.jobsWithLiveLease.mockResolvedValueOnce(new Set(['assess_stories']))
      await expect(isJobRunning('crawl_feeds')).resolves.toBe(false)
    })
  })

  describe('startScheduler', () => {
    const { initRetryBaseMs, initAlertAfterAttempts } = config.scheduler

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      stopScheduler()
      vi.useRealTimers()
    })

    it('retries with doubling delays until initScheduler succeeds, registering once', async () => {
      mockPrisma.jobRun.findMany
        .mockRejectedValueOnce(new Error('db down'))
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue([enabledCrawlJob])

      startScheduler()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(1)

      // First retry after the base delay
      await vi.advanceTimersByTimeAsync(initRetryBaseMs - 1)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(2)

      // Second retry after double the base delay
      await vi.advanceTimersByTimeAsync(initRetryBaseMs * 2 - 1)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(3)

      expect(mockSchedule).toHaveBeenCalledTimes(1)

      // No further attempts after success
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 2)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(3)
    })

    it('alerts exactly once, at the attempt threshold', async () => {
      mockPrisma.jobRun.findMany.mockRejectedValue(new Error('db down'))

      startScheduler()
      await vi.advanceTimersByTimeAsync(0)
      // Step through the attempts below the threshold, one retry delay at a time
      for (let attempt = 1; attempt < initAlertAfterAttempts; attempt++) {
        expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(attempt)
        expect(mockNotify).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(initRetryBaseMs * 2 ** (attempt - 1))
      }
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(initAlertAfterAttempts)
      expect(mockNotify).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: 'job-failure:scheduler',
        severity: 'critical',
        message: expect.stringContaining('db down'),
      }))

      // Many more failed attempts: no further alerts
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 5)
      expect(mockPrisma.jobRun.findMany.mock.calls.length).toBeGreaterThan(initAlertAfterAttempts + 2)
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('records a notice once it starts after the boot alert, since the alert itself could not be stored', async () => {
      for (let i = 0; i < initAlertAfterAttempts; i++) mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('db down'))
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledCrawlJob])

      startScheduler()
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 5)
      expect(mockNotify).toHaveBeenCalledTimes(2)
      expect(mockNotify).toHaveBeenLastCalledWith(expect.objectContaining({
        dedupeKey: 'job-failure:scheduler',
        severity: 'warning',
        message: expect.stringMatching(new RegExp(`started after ${initAlertAfterAttempts} failed attempts: db down`)),
      }))
    })

    it('records nothing on a start with no earlier alert', async () => {
      mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([enabledCrawlJob])
      startScheduler()
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 2)
      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('stopScheduler during the retry wait prevents any later attempt', async () => {
      mockPrisma.jobRun.findMany.mockRejectedValue(new Error('db down'))

      startScheduler()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(1)

      stopScheduler()
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 3)
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('SCHEDULER_ENABLED=false', () => {
    it('startScheduler loads and registers nothing', async () => {
      config.scheduler.enabled = false
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('crawl_feeds')])

      startScheduler()
      await flush()

      expect(mockPrisma.jobRun.findMany).not.toHaveBeenCalled()
      expect(mockSchedule).not.toHaveBeenCalled()
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })

    it('reloadJob schedules nothing', async () => {
      config.scheduler.enabled = false
      mockPrisma.jobRun.findUnique.mockResolvedValue(enabledCrawlJob)

      await reloadJob('crawl_feeds')

      expect(mockSchedule).not.toHaveBeenCalled()
    })
  })

  describe('initScheduler', () => {
    it('registers enabled jobs with valid cron expressions', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledCrawlJob])

      await initScheduler()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockSchedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function))
    })

    it('schedules a job with a fixed time zone in that zone, and every other job in the server\'s own', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([
        enabledCrawlJob,
        { ...enabledCrawlJob, jobName: 'publish_podcast', cronExpression: '0 7 * * 6' },
      ])

      await initScheduler()

      expect(mockSchedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function))
      expect(mockSchedule).toHaveBeenCalledWith('0 7 * * 6', expect.any(Function), { timezone: 'Europe/Berlin' })
    })

    it('skips disabled jobs', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledCrawlJob, enabled: false, lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with unknown handler', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledCrawlJob, jobName: 'unknown_job', lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with invalid cron expression', async () => {
      mockValidate.mockReturnValue(false)
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledCrawlJob, cronExpression: 'bad cron', lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('does not run a job that never completed: it waits for its first cron tick', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledCrawlJob, lastCompletedAt: null }])

      await initScheduler()
      await flush()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })

    it('runs an overdue job', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('crawl_feeds')])
      mockPrisma.jobRun.findUnique.mockResolvedValue(overdueRow('crawl_feeds'))

      await initScheduler()

      await vi.waitFor(() => expect(mockRunCrawlFeeds).toHaveBeenCalledTimes(1))
      expect(mockLease.claimJobRun).toHaveBeenCalledWith('crawl_feeds')
    })
  })

  describe('boot catch-up', () => {
    const rowsByName = (rows: ReturnType<typeof overdueRow>[]) =>
      ({ where }: { where: { jobName: string } }) => Promise.resolve(rows.find(row => row.jobName === where.jobName) ?? null)

    it('runs overdue jobs one after another in pipeline order', async () => {
      const rows = [overdueRow('assess_stories'), overdueRow('crawl_feeds')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName(rows))
      let finishCrawl: () => void = () => {}
      mockRunCrawlFeeds.mockImplementation(() => new Promise<void>(resolve => { finishCrawl = resolve }))

      await initScheduler()
      await vi.waitFor(() => expect(mockRunCrawlFeeds).toHaveBeenCalledTimes(1))
      await flush()
      expect(mockRunAssessStories).not.toHaveBeenCalled()

      finishCrawl()
      await vi.waitFor(() => expect(mockRunAssessStories).toHaveBeenCalledTimes(1))
    })

    it('skips a job whose re-read row is no longer overdue (its cron tick ran it meanwhile)', async () => {
      const rows = [overdueRow('crawl_feeds'), overdueRow('assess_stories')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(
        rowsByName([overdueRow('crawl_feeds'), { ...overdueRow('assess_stories'), lastCompletedAt: new Date() }]),
      )

      await initScheduler()
      await vi.waitFor(() => expect(mockRunCrawlFeeds).toHaveBeenCalledTimes(1))
      await flush()

      expect(mockRunAssessStories).not.toHaveBeenCalled()
    })

    it('skips a job disabled since boot', async () => {
      const rows = [overdueRow('crawl_feeds'), overdueRow('assess_stories')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(
        rowsByName([overdueRow('crawl_feeds'), { ...overdueRow('assess_stories'), enabled: false }]),
      )

      await initScheduler()
      await vi.waitFor(() => expect(mockRunCrawlFeeds).toHaveBeenCalledTimes(1))
      await flush()

      expect(mockRunAssessStories).not.toHaveBeenCalled()
    })

    it('stopScheduler mid-chain prevents the next step', async () => {
      const rows = [overdueRow('crawl_feeds'), overdueRow('assess_stories')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName(rows))
      let finishCrawl: () => void = () => {}
      mockRunCrawlFeeds.mockImplementation(() => new Promise<void>(resolve => { finishCrawl = resolve }))

      await initScheduler()
      await vi.waitFor(() => expect(mockRunCrawlFeeds).toHaveBeenCalledTimes(1))
      stopScheduler()
      finishCrawl()
      await flush()

      expect(mockRunAssessStories).not.toHaveBeenCalled()
    })
  })

  describe('estimateCronIntervalMs', () => {
    it('returns null for expressions with fewer than 5 parts', () => {
      expect(estimateCronIntervalMs('* * *')).toBeNull()
    })

    it('parses */N hour pattern as N hours', () => {
      expect(estimateCronIntervalMs('0 */6 * * *')).toBe(6 * HOUR)
      expect(estimateCronIntervalMs('0 */1 * * *')).toBe(1 * HOUR)
    })

    it('parses comma-separated hours as 24/count', () => {
      // 4 times per day → 6 hour interval
      expect(estimateCronIntervalMs('0 1,7,13,19 * * *')).toBe(6 * HOUR)
      // 2 times per day → 12 hour interval
      expect(estimateCronIntervalMs('0 9,21 * * *')).toBe(12 * HOUR)
    })

    it('parses single hour as daily (24 hours)', () => {
      expect(estimateCronIntervalMs('0 10 * * *')).toBe(24 * HOUR)
    })

    it('factors in single day-of-week as weekly', () => {
      // Saturday only → 7 * 24h = 168h
      expect(estimateCronIntervalMs('0 4 * * 6')).toBe(7 * 24 * HOUR)
    })

    it('factors in weekday range (1-5) as 7/5 multiplier', () => {
      // Weekdays at 9am → 24h * 7/5 = 33.6h
      expect(estimateCronIntervalMs('0 9 * * 1-5')).toBe(24 * (7 / 5) * 60 * 60 * 1000)
    })

    it('handles wrap-around day-of-week range', () => {
      // Fri-Tue (5-2) = 5 days → 24h * 7/5 = 33.6h
      expect(estimateCronIntervalMs('0 9 * * 5-2')).toBe(24 * (7 / 5) * 60 * 60 * 1000)
    })

    it('handles comma-separated days', () => {
      // Mon, Wed, Fri → 3 days → 24h * 7/3
      expect(estimateCronIntervalMs('0 10 * * 1,3,5')).toBe(24 * (7 / 3) * 60 * 60 * 1000)
    })

    it('treats day-of-week * as daily (multiplier 1)', () => {
      expect(estimateCronIntervalMs('0 10 * * *')).toBe(24 * HOUR)
    })

    it('treats day 7 and day 0 as the same (Sunday)', () => {
      // Both 0 and 7 represent Sunday
      expect(estimateCronIntervalMs('0 10 * * 0')).toBe(estimateCronIntervalMs('0 10 * * 7'))
    })

    it('returns null for unparseable hour field', () => {
      expect(estimateCronIntervalMs('0 * * * *')).toBeNull()
    })
  })

  describe('stopScheduler', () => {
    it('stops all registered tasks', async () => {
      const mockStop = vi.fn()
      mockSchedule.mockReturnValue({ stop: mockStop })
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledCrawlJob])

      await initScheduler()
      stopScheduler()

      expect(mockStop).toHaveBeenCalled()
    })
  })
})
