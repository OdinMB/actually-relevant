import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSchedule = vi.hoisted(() => vi.fn(() => ({ stop: vi.fn() })))
const mockValidate = vi.hoisted(() => vi.fn(() => true))

const mockPrisma = vi.hoisted(() => ({
  jobRun: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $disconnect: vi.fn(),
}))

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}))

const mockNotifyJobFailure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => ({ notifyJobFailure: mockNotifyJobFailure }))
vi.mock('./crawlFeeds.js', () => ({ runCrawlFeeds: vi.fn() }))
vi.mock('./preassessStories.js', () => ({ runPreassessStories: vi.fn() }))
vi.mock('./assessStories.js', () => ({ runAssessStories: vi.fn() }))
vi.mock('./selectStories.js', () => ({ runSelectStories: vi.fn() }))

const { initScheduler, startScheduler, stopScheduler, runJob, runningJobs, estimateCronIntervalMs } =
  await import('./scheduler.js')
const { config } = await import('../config.js')

const enabledCrawlJob = {
  jobName: 'crawl_feeds',
  enabled: true,
  cronExpression: '0 */6 * * *',
  lastCompletedAt: new Date(),
  lastStartedAt: null,
}

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidate.mockReturnValue(true)
    mockSchedule.mockReturnValue({ stop: vi.fn() })
    mockNotifyJobFailure.mockResolvedValue(undefined)
    mockPrisma.jobRun.update.mockReset().mockResolvedValue({})
    mockPrisma.jobRun.findMany.mockReset()
    stopScheduler()
    runningJobs.clear()
  })

  describe('runJob never rejects', () => {
    it('does not run the handler when the start write fails, and clears and alerts', async () => {
      mockPrisma.jobRun.update.mockRejectedValue(new Error('db down'))
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(handler).not.toHaveBeenCalled()
      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotifyJobFailure).toHaveBeenCalledWith('crawl_feeds', expect.stringContaining('db down'))
    })

    it('resolves when the handler throws and the error-path write also fails', async () => {
      mockPrisma.jobRun.update
        .mockResolvedValueOnce({}) // start write
        .mockRejectedValueOnce(new Error('db gone')) // error-path write
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotifyJobFailure).toHaveBeenCalledWith('crawl_feeds', 'handler boom')
    })

    it('treats a failed completion write as a job failure', async () => {
      mockPrisma.jobRun.update
        .mockResolvedValueOnce({}) // start write
        .mockRejectedValueOnce(new Error('completion write failed'))
        .mockResolvedValueOnce({}) // error-path write
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('crawl_feeds', handler)).resolves.toBeUndefined()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(runningJobs.has('crawl_feeds')).toBe(false)
      expect(mockNotifyJobFailure).toHaveBeenCalledWith('crawl_feeds', 'completion write failed')
    })

    it('a cron tick while every write fails produces no unhandled rejection', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledCrawlJob])
      await initScheduler()
      const tick = (mockSchedule.mock.calls[0] as unknown as [string, () => void])[1]

      mockPrisma.jobRun.update.mockRejectedValue(new Error('db down'))
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
      expect(mockNotifyJobFailure).toHaveBeenCalledWith('crawl_feeds', expect.stringContaining('db down'))
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
        expect(mockNotifyJobFailure).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(initRetryBaseMs * 2 ** (attempt - 1))
      }
      expect(mockPrisma.jobRun.findMany).toHaveBeenCalledTimes(initAlertAfterAttempts)
      expect(mockNotifyJobFailure).toHaveBeenCalledTimes(1)
      expect(mockNotifyJobFailure).toHaveBeenCalledWith('scheduler', expect.stringContaining('db down'))

      // Many more failed attempts: no further alerts
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 5)
      expect(mockPrisma.jobRun.findMany.mock.calls.length).toBeGreaterThan(initAlertAfterAttempts + 2)
      expect(mockNotifyJobFailure).toHaveBeenCalledTimes(1)
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

  describe('initScheduler', () => {
    it('registers enabled jobs with valid cron expressions', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'crawl_feeds',
          enabled: true,
          cronExpression: '0 */6 * * *',
          lastCompletedAt: new Date(),
          lastStartedAt: null,
        },
      ])

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
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'crawl_feeds',
          enabled: false,
          cronExpression: '0 */6 * * *',
          lastCompletedAt: null,
          lastStartedAt: null,
        },
      ])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with unknown handler', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'unknown_job',
          enabled: true,
          cronExpression: '0 */6 * * *',
          lastCompletedAt: null,
          lastStartedAt: null,
        },
      ])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with invalid cron expression', async () => {
      mockValidate.mockReturnValue(false)
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'crawl_feeds',
          enabled: true,
          cronExpression: 'bad cron',
          lastCompletedAt: null,
          lastStartedAt: null,
        },
      ])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('triggers overdue jobs immediately', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000) // 48 hours ago
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'crawl_feeds',
          enabled: true,
          cronExpression: '0 */6 * * *',
          lastCompletedAt: oldDate,
          lastStartedAt: null,
        },
      ])
      // runJob will call findUnique
      mockPrisma.jobRun.findUnique.mockResolvedValue({
        jobName: 'crawl_feeds',
        lastStartedAt: null,
        lastCompletedAt: oldDate,
      })
      mockPrisma.jobRun.update.mockResolvedValue({})

      await initScheduler()

      // Should have scheduled AND triggered immediately
      expect(mockSchedule).toHaveBeenCalledTimes(1)
      // runJob should have been called (marks as started)
      expect(mockPrisma.jobRun.update).toHaveBeenCalled()
    })
  })

  describe('estimateCronIntervalMs', () => {
    it('returns null for expressions with fewer than 5 parts', () => {
      expect(estimateCronIntervalMs('* * *')).toBeNull()
    })

    it('parses */N hour pattern as N hours', () => {
      expect(estimateCronIntervalMs('0 */6 * * *')).toBe(6 * 60 * 60 * 1000)
      expect(estimateCronIntervalMs('0 */1 * * *')).toBe(1 * 60 * 60 * 1000)
    })

    it('parses comma-separated hours as 24/count', () => {
      // 4 times per day → 6 hour interval
      expect(estimateCronIntervalMs('0 1,7,13,19 * * *')).toBe(6 * 60 * 60 * 1000)
      // 2 times per day → 12 hour interval
      expect(estimateCronIntervalMs('0 9,21 * * *')).toBe(12 * 60 * 60 * 1000)
    })

    it('parses single hour as daily (24 hours)', () => {
      expect(estimateCronIntervalMs('0 10 * * *')).toBe(24 * 60 * 60 * 1000)
    })

    it('factors in single day-of-week as weekly', () => {
      // Saturday only → 7 * 24h = 168h
      expect(estimateCronIntervalMs('0 4 * * 6')).toBe(7 * 24 * 60 * 60 * 1000)
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
      expect(estimateCronIntervalMs('0 10 * * *')).toBe(24 * 60 * 60 * 1000)
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
      mockPrisma.jobRun.findMany.mockResolvedValue([
        {
          jobName: 'crawl_feeds',
          enabled: true,
          cronExpression: '0 */6 * * *',
          lastCompletedAt: new Date(),
          lastStartedAt: null,
        },
      ])

      await initScheduler()
      stopScheduler()

      expect(mockStop).toHaveBeenCalled()
    })
  })
})
