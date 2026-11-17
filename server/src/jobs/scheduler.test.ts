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
const mockRunIntake = vi.hoisted(() => vi.fn())
const mockResumeHeldChains = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockJobTimeZone = vi.hoisted(() => vi.fn((_jobName: string): string | null => null))
vi.mock('./jobTimeZones.js', () => ({ jobTimeZone: mockJobTimeZone }))
const mockRunDailyEdition = vi.hoisted(() => vi.fn())
const mockSweepInterruptedRuns = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/notify.js')>()),
  notify: mockNotify,
}))

/** The notice the scheduler sends for a failed run of `jobName` whose message matches `message`. */
const failureOf = (jobName: string, message: unknown) => expect.objectContaining({ dedupeKey: `job-failure:${jobName}`, message })
vi.mock('./jobLease.js', () => mockLease)
// The sweep's own decisions are covered in interruptedRuns.test.ts; here it is the jobs it hands back
vi.mock('./interruptedRuns.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./interruptedRuns.js')>()),
  sweepInterruptedRuns: mockSweepInterruptedRuns,
}))
// The intake and the daily edition stand for any scheduled job here; the chains' own runs are covered in chains.test.ts
vi.mock('./chains.js', () => ({
  runChain: (name: string) => (name === 'intake_chain' ? mockRunIntake() : mockRunDailyEdition()),
  resumeHeldChains: mockResumeHeldChains,
  clearHeldChains: vi.fn(),
}))

const { initScheduler, startScheduler, stopScheduler, reloadJob, runJob, runningJobs, isJobRunning, estimateCronIntervalMs, waitForRunningJobs } =
  await import('./scheduler.js')
const { config } = await import('../config.js')
const { currentRun, emptyUsage, recordCall, reportRunResult } = await import('../lib/runUsage.js')

const HOUR = 60 * 60 * 1000

const enabledIntakeJob = {
  jobName: 'intake_chain',
  enabled: true,
  cronExpression: '0 */6 * * *',
  lastCompletedAt: new Date(),
  lastStartedAt: null,
  interruptedRuns: 0,
}

/** A row whose last finish is more than 2x its interval ago (overdue at boot). */
const overdueRow = (jobName: string) => ({ ...enabledIntakeJob, jobName, lastCompletedAt: new Date(Date.now() - 48 * HOUR) })

/** A row whose last run was interrupted `times` in a row and finished (recorded) just now: not overdue. */
const interruptedRow = (jobName: string, times = 1) => ({ ...enabledIntakeJob, jobName, interruptedRuns: times })

/** A findUnique stand-in answering from `rows`, as the catch-up chain re-reads each job. */
const rowsByName =
  (rows: (typeof enabledIntakeJob)[]) =>
  ({ where }: { where: { jobName: string } }) =>
    Promise.resolve(rows.find(row => row.jobName === where.jobName) ?? null)

/** A handler that runs until the returned `finish` is called. */
function blockingHandler(mock: ReturnType<typeof vi.fn>): () => void {
  let finish: () => void = () => {}
  mock.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finish = resolve
      }),
  )
  return () => finish()
}

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
    mockRunIntake.mockReset().mockResolvedValue(undefined)
    mockRunDailyEdition.mockReset().mockResolvedValue(undefined)
    mockSweepInterruptedRuns.mockReset().mockResolvedValue([])
    mockJobTimeZone.mockReset().mockReturnValue(null)
    config.scheduler.enabled = true
    stopScheduler()
    runningJobs.clear()
  })

  describe('runJob under the job lease', () => {
    it('runs the handler under the lease heartbeat and records a success', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)

      await runJob('intake_chain', handler)

      expect(mockLease.claimJobRun).toHaveBeenCalledWith('intake_chain')
      expect(mockLease.withJobLeaseHeartbeat).toHaveBeenCalledWith('intake_chain', handler)
      expect(handler).toHaveBeenCalledTimes(1)
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('intake_chain', null, emptyUsage(), null)
      expect(mockNotify).not.toHaveBeenCalled()
      expect(runningJobs.has('intake_chain')).toBe(false)
    })

    it('answers what became of the run', async () => {
      expect(await runJob('intake_chain', vi.fn().mockResolvedValue(undefined))).toEqual({ result: 'succeeded' })
      expect(await runJob('intake_chain', vi.fn().mockRejectedValue(new Error('boom')))).toEqual({ result: 'failed', error: 'boom' })
      mockLease.claimJobRun.mockResolvedValueOnce('held')
      expect(await runJob('intake_chain', vi.fn())).toEqual({ result: 'skipped' })
    })

    it("runs the handler in a run scope with the job's Flex switch and its cut-offs counted from this run's start", async () => {
      vi.useFakeTimers({ now: new Date('2026-11-17T10:00:00Z'), toFake: ['Date'] })
      try {
        mockPrisma.jobRun.findUnique.mockResolvedValue({ flex: true, flexHours: 1.5, deadlineHours: 3 })
        let seen: ReturnType<typeof currentRun>
        await runJob('intake_chain', async () => {
          seen = currentRun()
        })
        expect(seen).toMatchObject({
          jobName: 'intake_chain',
          flex: true,
          flexUntil: new Date('2026-11-17T11:30:00Z'),
          deadline: new Date('2026-11-17T13:00:00Z'),
        })

        // No cut-off set: none on the run
        mockPrisma.jobRun.findUnique.mockResolvedValue({ flex: true, flexHours: null, deadlineHours: null })
        await runJob('intake_chain', async () => {
          seen = currentRun()
        })
        expect(seen).toMatchObject({ flexUntil: null, deadline: null })
      } finally {
        vi.useRealTimers()
      }
    })

    it('records what the run spent, on a failure too', async () => {
      await runJob('intake_chain', async () => {
        recordCall(currentRun()!, { model: 'gpt-6-luna', tier: 'flex', input: 1_000_000, cached: 0, output: 0, fellBack: false })
        throw new Error('boom')
      })
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('intake_chain', 'boom', expect.objectContaining({ calls: 1, flexCalls: 1, costUsd: 0.05 }), null)
    })

    it('records what the run said it did, its last report winning, on a failure too', async () => {
      await runJob('intake_chain', async () => {
        reportRunResult('first')
        reportRunResult('12 new stories from 3 feeds')
      })
      expect(mockLease.finishJobRun).toHaveBeenLastCalledWith('intake_chain', null, emptyUsage(), '12 new stories from 3 feeds')
      await runJob('intake_chain', async () => {
        reportRunResult('Rated 2 of 5 stories')
        throw new Error('boom')
      })
      expect(mockLease.finishJobRun).toHaveBeenLastCalledWith('intake_chain', 'boom', emptyUsage(), 'Rated 2 of 5 stories')
    })

    it('records the error, not a success, when the handler fails, and alerts', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await runJob('intake_chain', handler)

      expect(mockLease.finishJobRun).toHaveBeenCalledTimes(1)
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('intake_chain', 'handler boom', emptyUsage(), null)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', 'handler boom'))
    })

    it('skips quietly while another process holds the lease: no handler, no record, no alert', async () => {
      mockLease.claimJobRun.mockResolvedValueOnce('held')
      const handler = vi.fn()

      await runJob('intake_chain', handler)

      expect(handler).not.toHaveBeenCalled()
      expect(mockLease.finishJobRun).not.toHaveBeenCalled()
      expect(mockNotify).not.toHaveBeenCalled()
      expect(runningJobs.has('intake_chain')).toBe(false)
    })

    it('treats a job with no row as a failure and alerts', async () => {
      mockLease.claimJobRun.mockRejectedValueOnce(new Error('job intake_chain has no job_runs row'))
      const handler = vi.fn()

      await runJob('intake_chain', handler)

      expect(handler).not.toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', expect.stringContaining('no job_runs row')))
    })

    it('skips a second run in the same process without touching the database', async () => {
      runningJobs.add('intake_chain')
      await runJob('intake_chain', vi.fn())
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })
  })

  describe('waitForRunningJobs (graceful shutdown)', () => {
    it('resolves at once with nothing running', async () => {
      expect(await waitForRunningJobs(1000)).toEqual([])
    })

    it('waits for a run in progress, its bookkeeping included', async () => {
      let finish!: () => void
      const handler = vi.fn(
        () =>
          new Promise<void>(r => {
            finish = r
          }),
      )
      void runJob('intake_chain', handler)
      await flush()

      const waiting = waitForRunningJobs(5000)
      finish()

      expect(await waiting).toEqual([])
      expect(mockLease.finishJobRun).toHaveBeenCalledWith('intake_chain', null, emptyUsage(), null)
    })

    it('gives up at the deadline and names the jobs still running', async () => {
      let finish!: () => void
      void runJob(
        'intake_chain',
        () =>
          new Promise<void>(r => {
            finish = r
          }),
      )
      await flush()

      expect(await waitForRunningJobs(20)).toEqual(['intake_chain'])

      finish()
      await flush()
      expect(await waitForRunningJobs(20)).toEqual([])
    })
  })

  describe('runJob never rejects', () => {
    it('does not run the handler when the claim fails, and clears and alerts', async () => {
      mockLease.claimJobRun.mockRejectedValue(new Error('db down'))
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('intake_chain', handler)).resolves.toEqual({ result: 'failed', error: 'db down' })

      expect(handler).not.toHaveBeenCalled()
      expect(runningJobs.has('intake_chain')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', expect.stringContaining('db down')))
    })

    it('resolves when the handler throws and the error-path write also fails', async () => {
      mockLease.finishJobRun.mockRejectedValueOnce(new Error('db gone'))
      const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

      await expect(runJob('intake_chain', handler)).resolves.toEqual({ result: 'failed', error: 'handler boom' })

      expect(runningJobs.has('intake_chain')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', 'handler boom'))
    })

    it('treats a failed completion write as a job failure', async () => {
      mockLease.finishJobRun.mockRejectedValueOnce(new Error('completion write failed'))
      const handler = vi.fn().mockResolvedValue(undefined)

      await expect(runJob('intake_chain', handler)).resolves.toEqual({ result: 'failed', error: 'completion write failed' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(runningJobs.has('intake_chain')).toBe(false)
      expect(mockLease.finishJobRun).toHaveBeenLastCalledWith('intake_chain', 'completion write failed', emptyUsage(), null)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', 'completion write failed'))
    })

    it('a cron tick while every write fails produces no unhandled rejection', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])
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
      expect(runningJobs.has('intake_chain')).toBe(false)
      expect(mockNotify).toHaveBeenCalledWith(failureOf('intake_chain', expect.stringContaining('db down')))
    })
  })

  describe('isJobRunning', () => {
    it('is true for a run in this process, without asking the database', async () => {
      runningJobs.add('intake_chain')
      await expect(isJobRunning('intake_chain')).resolves.toBe(true)
      expect(mockLease.jobsWithLiveLease).not.toHaveBeenCalled()
    })

    it("is true while another process's lease on the job is live", async () => {
      mockLease.jobsWithLiveLease.mockResolvedValueOnce(new Set(['intake_chain']))
      await expect(isJobRunning('intake_chain')).resolves.toBe(true)
    })

    it('is false when no process runs it', async () => {
      mockLease.jobsWithLiveLease.mockResolvedValueOnce(new Set(['daily_edition_chain']))
      await expect(isJobRunning('intake_chain')).resolves.toBe(false)
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
      mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down')).mockResolvedValue([enabledIntakeJob])

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
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          dedupeKey: 'job-failure:scheduler',
          severity: 'critical',
          message: expect.stringContaining('db down'),
        }),
      )

      // Many more failed attempts: no further alerts
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 5)
      expect(mockPrisma.jobRun.findMany.mock.calls.length).toBeGreaterThan(initAlertAfterAttempts + 2)
      expect(mockNotify).toHaveBeenCalledTimes(1)
    })

    it('records a notice once it starts after the boot alert, since the alert itself could not be stored', async () => {
      for (let i = 0; i < initAlertAfterAttempts; i++) mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('db down'))
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])

      startScheduler()
      await vi.advanceTimersByTimeAsync(config.scheduler.initRetryMaxMs * 5)
      expect(mockNotify).toHaveBeenCalledTimes(2)
      expect(mockNotify).toHaveBeenLastCalledWith(
        expect.objectContaining({
          dedupeKey: 'job-failure:scheduler',
          severity: 'warning',
          message: expect.stringMatching(new RegExp(`started after ${initAlertAfterAttempts} failed attempts: db down`)),
        }),
      )
    })

    it('records nothing on a start with no earlier alert', async () => {
      mockPrisma.jobRun.findMany.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([enabledIntakeJob])
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
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('intake_chain')])

      startScheduler()
      await flush()

      expect(mockPrisma.jobRun.findMany).not.toHaveBeenCalled()
      expect(mockSchedule).not.toHaveBeenCalled()
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })

    it('reloadJob schedules nothing', async () => {
      config.scheduler.enabled = false
      mockPrisma.jobRun.findUnique.mockResolvedValue(enabledIntakeJob)

      await reloadJob('intake_chain')

      expect(mockSchedule).not.toHaveBeenCalled()
    })
  })

  describe('initScheduler', () => {
    it('registers enabled jobs with valid cron expressions', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])

      await initScheduler()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockSchedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function))
    })

    it('sets the chains held for a step’s time going again', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])
      await initScheduler()
      expect(mockResumeHeldChains).toHaveBeenCalledTimes(1)
    })

    it("never schedules a chain's step on its own, even an enabled and overdue one, nor on reload", async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('preassess_stories'), overdueRow('select_stories')])
      mockPrisma.jobRun.findUnique.mockResolvedValue(overdueRow('preassess_stories'))

      await initScheduler()
      await reloadJob('preassess_stories')
      await flush()

      expect(mockSchedule).not.toHaveBeenCalled()
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })

    it("schedules a job with a fixed time zone in that zone, and every other job in the server's own", async () => {
      // The podcast's publish jobs, the zoned ones, are chain steps now; any job with a zone is scheduled in it
      mockJobTimeZone.mockImplementation((jobName: string) => (jobName === 'cleanup_old_stories' ? 'Europe/Berlin' : null))
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob, { ...enabledIntakeJob, jobName: 'cleanup_old_stories', cronExpression: '0 3 1 * *' }])

      await initScheduler()

      expect(mockSchedule).toHaveBeenCalledWith('0 */6 * * *', expect.any(Function))
      expect(mockSchedule).toHaveBeenCalledWith('0 3 1 * *', expect.any(Function), { timezone: 'Europe/Berlin' })
    })

    it('skips disabled jobs', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledIntakeJob, enabled: false, lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with unknown handler', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledIntakeJob, jobName: 'unknown_job', lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('skips jobs with invalid cron expression', async () => {
      mockValidate.mockReturnValue(false)
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledIntakeJob, cronExpression: 'bad cron', lastCompletedAt: null }])

      await initScheduler()

      expect(mockSchedule).not.toHaveBeenCalled()
    })

    it('does not run a job that never completed: it waits for its first cron tick', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([{ ...enabledIntakeJob, lastCompletedAt: null }])

      await initScheduler()
      await flush()

      expect(mockSchedule).toHaveBeenCalledTimes(1)
      expect(mockLease.claimJobRun).not.toHaveBeenCalled()
    })

    it('runs an overdue job', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('intake_chain')])
      mockPrisma.jobRun.findUnique.mockResolvedValue(overdueRow('intake_chain'))

      await initScheduler()

      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      expect(mockLease.claimJobRun).toHaveBeenCalledWith('intake_chain')
    })
  })

  describe('boot catch-up', () => {
    it('runs overdue jobs one after another in pipeline order', async () => {
      const rows = [overdueRow('daily_edition_chain'), overdueRow('intake_chain')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName(rows))
      let finishIntake: () => void = () => {}
      mockRunIntake.mockImplementation(
        () =>
          new Promise<void>(resolve => {
            finishIntake = resolve
          }),
      )

      await initScheduler()
      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      await flush()
      expect(mockRunDailyEdition).not.toHaveBeenCalled()

      finishIntake()
      await vi.waitFor(() => expect(mockRunDailyEdition).toHaveBeenCalledTimes(1))
    })

    it('skips a job whose re-read row is no longer overdue (its cron tick ran it meanwhile)', async () => {
      const rows = [overdueRow('intake_chain'), overdueRow('daily_edition_chain')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(
        rowsByName([overdueRow('intake_chain'), { ...overdueRow('daily_edition_chain'), lastCompletedAt: new Date() }]),
      )

      await initScheduler()
      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      await flush()

      expect(mockRunDailyEdition).not.toHaveBeenCalled()
    })

    it('skips a job disabled since boot', async () => {
      const rows = [overdueRow('intake_chain'), overdueRow('daily_edition_chain')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName([overdueRow('intake_chain'), { ...overdueRow('daily_edition_chain'), enabled: false }]))

      await initScheduler()
      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      await flush()

      expect(mockRunDailyEdition).not.toHaveBeenCalled()
    })

    it('stopScheduler mid-chain prevents the next step', async () => {
      const rows = [overdueRow('intake_chain'), overdueRow('daily_edition_chain')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName(rows))
      let finishIntake: () => void = () => {}
      mockRunIntake.mockImplementation(
        () =>
          new Promise<void>(resolve => {
            finishIntake = resolve
          }),
      )

      await initScheduler()
      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      stopScheduler()
      finishIntake()
      await flush()

      expect(mockRunDailyEdition).not.toHaveBeenCalled()
    })
  })

  describe('interrupted runs', () => {
    const recheckMs = config.scheduler.leaseSeconds * 1000 + config.scheduler.interruptedRecheckSlackMs

    afterEach(() => {
      stopScheduler()
      vi.useRealTimers()
    })

    it('reruns what the start sweep hands back with the overdue jobs, in pipeline order, a job both overdue and interrupted once', async () => {
      const rows = [overdueRow('daily_edition_chain'), interruptedRow('intake_chain')]
      mockPrisma.jobRun.findMany.mockResolvedValue(rows)
      mockPrisma.jobRun.findUnique.mockImplementation(
        rowsByName([{ ...overdueRow('daily_edition_chain'), interruptedRuns: 1 }, interruptedRow('intake_chain')]),
      )
      mockSweepInterruptedRuns.mockResolvedValueOnce(['daily_edition_chain', 'intake_chain'])
      const finishIntake = blockingHandler(mockRunIntake)

      await initScheduler()
      await vi.waitFor(() => expect(mockRunIntake).toHaveBeenCalledTimes(1))
      await flush()
      expect(mockRunDailyEdition).not.toHaveBeenCalled()

      finishIntake()
      await vi.waitFor(() => expect(mockRunDailyEdition).toHaveBeenCalledTimes(1))
      await flush()
      expect(mockRunDailyEdition).toHaveBeenCalledTimes(1)
      expect(mockRunIntake).toHaveBeenCalledTimes(1)
    })

    it('tells the sweep which jobs this process schedules', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob, { ...enabledIntakeJob, jobName: 'daily_edition_chain', enabled: false }])

      await initScheduler()
      await vi.waitFor(() => expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(1))

      const isScheduled = mockSweepInterruptedRuns.mock.calls[0]![0] as (jobName: string) => boolean
      expect(isScheduled('intake_chain')).toBe(true)
      expect(isScheduled('daily_edition_chain')).toBe(false)
    })

    it('skips a rerun whose re-read row shows the job finished meanwhile', async () => {
      mockPrisma.jobRun.findMany.mockResolvedValue([interruptedRow('intake_chain')])
      mockPrisma.jobRun.findUnique.mockResolvedValue({ ...interruptedRow('intake_chain'), interruptedRuns: 0 })
      mockSweepInterruptedRuns.mockResolvedValueOnce(['intake_chain'])

      await initScheduler()
      await vi.waitFor(() => expect(mockPrisma.jobRun.findUnique).toHaveBeenCalled())
      await flush()

      expect(mockRunIntake).not.toHaveBeenCalled()
    })

    it('sweeps once more after a lease live at the start would have run out, and reruns what that finds', async () => {
      vi.useFakeTimers()
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])
      mockPrisma.jobRun.findUnique.mockResolvedValue(interruptedRow('intake_chain'))
      mockSweepInterruptedRuns.mockResolvedValueOnce([]).mockResolvedValueOnce(['intake_chain'])

      await initScheduler()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(recheckMs - 1)
      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(1)
      expect(mockRunIntake).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(2)
      expect(mockRunIntake).toHaveBeenCalledTimes(1)

      // Only once
      await vi.advanceTimersByTimeAsync(recheckMs * 3)
      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(2)
    })

    it('stopScheduler cancels the second sweep', async () => {
      vi.useFakeTimers()
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])

      await initScheduler()
      await vi.advanceTimersByTimeAsync(0)
      stopScheduler()
      await vi.advanceTimersByTimeAsync(recheckMs * 2)

      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(1)
    })

    it('a rerun the second sweep finds waits for the catch-up still running before it', async () => {
      vi.useFakeTimers()
      mockPrisma.jobRun.findMany.mockResolvedValue([overdueRow('intake_chain'), { ...enabledIntakeJob, jobName: 'daily_edition_chain' }])
      mockPrisma.jobRun.findUnique.mockImplementation(rowsByName([overdueRow('intake_chain'), interruptedRow('daily_edition_chain')]))
      mockSweepInterruptedRuns.mockResolvedValueOnce([]).mockResolvedValueOnce(['daily_edition_chain'])
      const finishIntake = blockingHandler(mockRunIntake)

      await initScheduler()
      await vi.advanceTimersByTimeAsync(recheckMs)
      expect(mockSweepInterruptedRuns).toHaveBeenCalledTimes(2)
      expect(mockRunIntake).toHaveBeenCalledTimes(1)
      expect(mockRunDailyEdition).not.toHaveBeenCalled()

      finishIntake()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockRunDailyEdition).toHaveBeenCalledTimes(1)
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

    it('factors in a fixed day of the month as monthly', () => {
      expect(estimateCronIntervalMs('0 3 1 * *')).toBe(30 * 24 * HOUR)
      expect(estimateCronIntervalMs('0 3 1,15 * *')).toBe(15 * 24 * HOUR)
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
      mockPrisma.jobRun.findMany.mockResolvedValue([enabledIntakeJob])

      await initScheduler()
      stopScheduler()

      expect(mockStop).toHaveBeenCalled()
    })
  })
})
