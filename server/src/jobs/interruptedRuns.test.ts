import { describe, it, expect, vi, beforeEach } from 'vitest'

// The statements themselves run against PostgreSQL in jobLease.db.test.ts; this file covers the
// decisions made on their results: what is resumed, what is alerted, which counts start again.
const mockLease = vi.hoisted(() => ({
  recordInterruptedHere: vi.fn(),
  recordAbandonedRuns: vi.fn(),
  interruptedJobRuns: vi.fn(),
  clearInterruptedRuns: vi.fn(),
}))
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLog }))
vi.mock('./jobLease.js', () => mockLease)
vi.mock('../lib/notify.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/notify.js')>()),
  notify: mockNotify,
}))

const { sweepInterruptedRuns, recordShutdownInterruptions, isResumable, RESUMABLE_JOBS } = await import('./interruptedRuns.js')
const { JOB_HANDLERS } = await import('./handlers.js')
const { config } = await import('../config.js')

const interrupted = (jobName: string, interruptedRuns = 1, lastError = 'Interrupted: the server shut down') => ({ jobName, interruptedRuns, lastError })
const everyJobScheduled = () => true
/** The notice sent for `jobName` whose message matches `message`. */
const noticeFor = (jobName: string, message: unknown) => expect.objectContaining({ dedupeKey: `job-failure:${jobName}`, message })

describe('interrupted runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLease.recordAbandonedRuns.mockReset().mockResolvedValue([])
    mockLease.interruptedJobRuns.mockReset().mockResolvedValue([])
    mockLease.clearInterruptedRuns.mockReset().mockResolvedValue(undefined)
    mockLease.recordInterruptedHere.mockReset().mockResolvedValue([])
  })

  describe('sweepInterruptedRuns', () => {
    it('resumes a pipeline job the shutdown recorded as interrupted, without a notice', async () => {
      mockLease.interruptedJobRuns.mockResolvedValue([interrupted('crawl_feeds')])

      expect(await sweepInterruptedRuns(everyJobScheduled)).toEqual(['crawl_feeds'])

      expect(mockNotify).not.toHaveBeenCalled()
      expect(mockLease.clearInterruptedRuns).not.toHaveBeenCalled()
    })

    it('records the runs whose process died first, and alerts each with its reason, resumed or not', async () => {
      mockLease.recordAbandonedRuns.mockResolvedValue(['crawl_feeds', 'publish_newsletter'])
      mockLease.interruptedJobRuns.mockResolvedValue([
        interrupted('crawl_feeds', 1, 'Interrupted: crawl died'),
        interrupted('publish_newsletter', 1, 'Interrupted: send died'),
      ])

      expect(await sweepInterruptedRuns(everyJobScheduled)).toEqual(['crawl_feeds'])

      expect(mockLease.recordAbandonedRuns.mock.invocationCallOrder[0]).toBeLessThan(mockLease.interruptedJobRuns.mock.invocationCallOrder[0]!)
      expect(mockNotify).toHaveBeenCalledTimes(2)
      expect(mockNotify).toHaveBeenCalledWith(noticeFor('crawl_feeds', expect.stringContaining('Interrupted: crawl died')))
      expect(mockNotify).toHaveBeenCalledWith(noticeFor('publish_newsletter', expect.stringContaining('Interrupted: send died')))
      expect(mockLease.clearInterruptedRuns).toHaveBeenCalledWith('publish_newsletter')
      expect(mockLease.clearInterruptedRuns).toHaveBeenCalledTimes(1)
    })

    it('hands the statements format() templates with exactly one placeholder', async () => {
      await sweepInterruptedRuns(everyJobScheduled)
      await recordShutdownInterruptions(['crawl_feeds'])

      for (const template of [mockLease.recordAbandonedRuns.mock.calls[0]![0], mockLease.recordInterruptedHere.mock.calls[0]![1]] as string[]) {
        expect(template.match(/%/g)).toEqual(['%'])
        expect(template).toContain('%s')
      }
    })

    it('stops resuming once a job was interrupted more than maxResumes times in a row: one notice, and its count starts again', async () => {
      const { maxResumes } = config.scheduler
      mockLease.interruptedJobRuns.mockResolvedValue([interrupted('crawl_feeds', maxResumes), interrupted('assess_stories', maxResumes + 1)])

      expect(await sweepInterruptedRuns(everyJobScheduled)).toEqual(['crawl_feeds'])

      expect(mockLease.clearInterruptedRuns).toHaveBeenCalledWith('assess_stories')
      expect(mockLease.clearInterruptedRuns).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledWith(noticeFor('assess_stories', expect.stringContaining(`${maxResumes + 1} times in a row`)))
    })

    it('resumes exactly the resumable jobs of the registry; every other one is alerted and its count starts again', async () => {
      const jobNames = Object.keys(JOB_HANDLERS)
      mockLease.interruptedJobRuns.mockResolvedValue(jobNames.map(jobName => interrupted(jobName)))

      const resumed = await sweepInterruptedRuns(everyJobScheduled)

      const notResumable = jobNames.filter(jobName => !RESUMABLE_JOBS.has(jobName))
      expect(notResumable.length).toBeGreaterThan(0)
      expect([...resumed].sort()).toEqual(jobNames.filter(jobName => RESUMABLE_JOBS.has(jobName)).sort())
      expect(mockLease.clearInterruptedRuns.mock.calls.map(([jobName]) => jobName).sort()).toEqual([...notResumable].sort())
      for (const jobName of notResumable) expect(mockNotify).toHaveBeenCalledWith(noticeFor(jobName, expect.any(String)))
    })

    it('never resumes a job that sends, posts, publishes episodes or deletes', () => {
      // A tripwire on purpose: rerunning one of these on its own could repeat a send or a post, so
      // adding one to RESUMABLE_JOBS has to change this test too
      for (const jobName of [
        'generate_newsletter',
        'publish_newsletter',
        'generate_podcast',
        'publish_podcast',
        'social_auto_post',
        'send_queued_confirmations',
        'poll_plunk_activity',
        'cleanup_old_stories',
      ]) {
        expect(isResumable({ jobName, interruptedRuns: 1 })).toBe(false)
      }
    })

    it('does not resume a job this process does not schedule (disabled meanwhile)', async () => {
      mockLease.interruptedJobRuns.mockResolvedValue([interrupted('crawl_feeds'), interrupted('assess_stories')])

      expect(await sweepInterruptedRuns(jobName => jobName !== 'crawl_feeds')).toEqual(['assess_stories'])

      expect(mockLease.clearInterruptedRuns).toHaveBeenCalledWith('crawl_feeds')
      expect(mockNotify).toHaveBeenCalledWith(noticeFor('crawl_feeds', expect.any(String)))
    })

    it('never throws: a failed statement is logged and nothing is resumed', async () => {
      mockLease.recordAbandonedRuns.mockRejectedValue(new Error('db down'))

      await expect(sweepInterruptedRuns(everyJobScheduled)).resolves.toEqual([])

      expect(mockLog.error).toHaveBeenCalled()
    })
  })

  describe('isResumable', () => {
    it('is true for a resumable job interrupted between once and maxResumes times', () => {
      const { maxResumes } = config.scheduler
      expect(isResumable({ jobName: 'crawl_feeds', interruptedRuns: 0 })).toBe(false)
      expect(isResumable({ jobName: 'crawl_feeds', interruptedRuns: 1 })).toBe(true)
      expect(isResumable({ jobName: 'crawl_feeds', interruptedRuns: maxResumes })).toBe(true)
      expect(isResumable({ jobName: 'crawl_feeds', interruptedRuns: maxResumes + 1 })).toBe(false)
    })
  })

  describe('recordShutdownInterruptions', () => {
    it('records the jobs still running at the drain deadline as interrupted by the shutdown', async () => {
      mockLease.recordInterruptedHere.mockResolvedValue(['crawl_feeds'])

      await recordShutdownInterruptions(['crawl_feeds'])

      expect(mockLease.recordInterruptedHere).toHaveBeenCalledWith(['crawl_feeds'], expect.any(String))
      expect(mockLog.warn).toHaveBeenCalled()
    })

    it('writes nothing when no job was still running', async () => {
      await recordShutdownInterruptions([])
      expect(mockLease.recordInterruptedHere).not.toHaveBeenCalled()
    })

    it('logs a failed write and never throws, so the shutdown carries on', async () => {
      mockLease.recordInterruptedHere.mockRejectedValue(new Error('db gone'))

      await expect(recordShutdownInterruptions(['crawl_feeds'])).resolves.toBeUndefined()

      expect(mockLog.error).toHaveBeenCalled()
    })
  })
})
