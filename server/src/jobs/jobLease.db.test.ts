import { describe, it, expect, vi, beforeEach } from 'vitest'

// The levels and their notices are spending.db.test.ts's; here, that the finish calls the check and survives its failure
const mockChecks = vi.hoisted(() => ({ checkSpendWarnings: vi.fn() }))
vi.mock('../services/spending.js', () => mockChecks)

const { default: prisma } = await import('../lib/prisma.js')
const { config } = await import('../config.js')
const { describeDb, useTestDatabase } = await import('../test/db/harness.js')
const { emptyUsage } = await import('../lib/runUsage.js')
const { utcMonthStart } = await import('../services/podcastGuards.js')
const {
  claimJobRun,
  clearInterruptedRuns,
  finishJobRun,
  interruptedJobRuns,
  jobsWithLiveLease,
  LEASE_HOLDER,
  recordAbandonedRuns,
  recordInterruptedHere,
  releaseHeldJobLeases,
} = await import('./jobLease.js')

beforeEach(() => {
  mockChecks.checkSpendWarnings.mockReset().mockResolvedValue(undefined)
})

const JOB = 'crawl_feeds'

async function seedJob(lease?: { by: string; secondsFromNow: number }) {
  await prisma.jobRun.create({ data: { jobName: JOB, cronExpression: '0 * * * *' } })
  if (lease) {
    await prisma.$executeRaw`
      UPDATE job_runs SET locked_by = ${lease.by},
        locked_until = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${lease.secondsFromNow}::int)
      WHERE job_name = ${JOB}`
  }
}

const row = () => prisma.jobRun.findUniqueOrThrow({ where: { jobName: JOB } })

describeDb('job lease (PostgreSQL)', () => {
  useTestDatabase()

  describe('claimJobRun', () => {
    it('claims a free job, stamping the start and clearing the last error', async () => {
      await seedJob()
      await prisma.jobRun.update({ where: { jobName: JOB }, data: { lastError: 'old failure' } })

      expect(await claimJobRun(JOB)).toBe('claimed')

      const job = await row()
      expect(job.lockedBy).toBe(LEASE_HOLDER)
      // leaseSeconds from now on the database clock (UTC, timestamp without time zone)
      const [lease] = await prisma.$queryRaw<{ seconds: number }[]>`
        SELECT EXTRACT(EPOCH FROM locked_until - (now() AT TIME ZONE 'UTC'))::float AS seconds FROM job_runs WHERE job_name = ${JOB}`
      expect(lease!.seconds).toBeGreaterThan(config.scheduler.leaseSeconds - 30)
      expect(lease!.seconds).toBeLessThanOrEqual(config.scheduler.leaseSeconds)
      expect(job.lastStartedAt).not.toBeNull()
      expect(job.lastError).toBeNull()
    })

    it("is 'held' while another process's lease is live, and changes nothing", async () => {
      await seedJob({ by: 'other-host:1:abc', secondsFromNow: 600 })

      expect(await claimJobRun(JOB)).toBe('held')

      const job = await row()
      expect(job.lockedBy).toBe('other-host:1:abc')
      expect(job.lastStartedAt).toBeNull()
    })

    it("takes over another process's expired lease", async () => {
      await seedJob({ by: 'other-host:1:abc', secondsFromNow: -5 })

      expect(await claimJobRun(JOB)).toBe('claimed')
      expect((await row()).lockedBy).toBe(LEASE_HOLDER)
    })

    it('lets the holder claim again', async () => {
      await seedJob({ by: LEASE_HOLDER, secondsFromNow: 600 })
      expect(await claimJobRun(JOB)).toBe('claimed')
    })

    it('lets exactly one of two concurrent claims win', async () => {
      await seedJob()
      // Same holder id here, so the loser is only told apart by the row count: run the second
      // claim as a foreign holder by hand to prove the WHERE clause is atomic
      const [mine, theirs] = await Promise.all([
        claimJobRun(JOB),
        prisma.$executeRaw`
          UPDATE job_runs SET locked_by = 'other-host:2:def',
            locked_until = (now() AT TIME ZONE 'UTC') + interval '10 minutes'
          WHERE job_name = ${JOB} AND (locked_until IS NULL OR locked_until < (now() AT TIME ZONE 'UTC'))`,
      ])
      const job = await row()
      if (mine === 'claimed') {
        expect(theirs).toBe(0)
        expect(job.lockedBy).toBe(LEASE_HOLDER)
      } else {
        expect(theirs).toBe(1)
        expect(job.lockedBy).toBe('other-host:2:def')
      }
    })

    it('throws when the job has no row', async () => {
      await expect(claimJobRun('no_such_job')).rejects.toThrow(/no job_runs row/)
    })
  })

  describe('finishJobRun', () => {
    it('records success and releases its own lease', async () => {
      await seedJob()
      await claimJobRun(JOB)

      await finishJobRun(JOB, null)

      const job = await row()
      expect(job.lastCompletedAt).not.toBeNull()
      expect(job.lastSucceededAt).not.toBeNull()
      expect(job.lastError).toBeNull()
      expect(job.lockedBy).toBeNull()
      expect(job.lockedUntil).toBeNull()
    })

    it("stores what the run spent, and an interrupted run's record clears it", async () => {
      await seedJob()
      await claimJobRun(JOB)
      const usage = { ...emptyUsage(), calls: 3, flexCalls: 2, costUsd: 0.125 }

      await finishJobRun(JOB, null, usage)
      expect((await row()).lastRunUsage).toEqual(usage)

      await prisma.jobRun.update({ where: { jobName: JOB }, data: { lastStartedAt: new Date(Date.now() + 60_000) } })
      await recordAbandonedRuns('Interrupted (started %s)')
      expect((await row()).lastRunUsage).toBeNull()
    })

    it('records a failure without a success stamp', async () => {
      await seedJob()
      await claimJobRun(JOB)

      await finishJobRun(JOB, 'boom')

      const job = await row()
      expect(job.lastError).toBe('boom')
      expect(job.lastSucceededAt).toBeNull()
      expect(job.lockedBy).toBeNull()
    })

    it("leaves another process's lease in place", async () => {
      await seedJob({ by: 'other-host:1:abc', secondsFromNow: 600 })

      await finishJobRun(JOB, null)

      const job = await row()
      expect(job.lastCompletedAt).not.toBeNull()
      expect(job.lockedBy).toBe('other-host:1:abc')
      expect(job.lockedUntil).not.toBeNull()
    })

    describe("the job's monthly spend", () => {
      const thisMonth = () => utcMonthStart(new Date())
      const monthRows = () => prisma.jobMonthSpend.findMany({ orderBy: [{ jobName: 'asc' }, { month: 'asc' }] })
      const spent = (costUsd: number, otherUsd: number, searchCredits: number) => ({
        ...emptyUsage(),
        calls: 4,
        costUsd,
        standardCostUsd: costUsd * 2,
        otherUsd,
        searchCredits,
      })

      it("adds each run's spend to the job's row for this UTC month, a failed run's too", async () => {
        await seedJob()

        await finishJobRun(JOB, null, spent(0.5, 0.1, 12))
        await finishJobRun(JOB, 'boom', spent(0.25, 0.05, 6))

        expect(await monthRows()).toEqual([
          {
            jobName: JOB,
            month: thisMonth(),
            costUsd: expect.closeTo(0.75, 10),
            standardCostUsd: expect.closeTo(1.5, 10),
            searchUsd: expect.closeTo(0.15, 10),
            searchCredits: 18,
            runs: 2,
          },
        ])
        expect(mockChecks.checkSpendWarnings.mock.calls).toEqual([[JOB], [JOB]])
      })

      it('starts a new row in a new month, leaving the month before as it was', async () => {
        await seedJob()
        const lastMonth = new Date(Date.UTC(thisMonth().getUTCFullYear(), thisMonth().getUTCMonth() - 1, 1))
        await prisma.jobMonthSpend.create({
          data: { jobName: JOB, month: lastMonth, costUsd: 3, standardCostUsd: 6, searchUsd: 1, searchCredits: 125, runs: 9 },
        })

        await finishJobRun(JOB, null, spent(0.5, 0, 0))

        expect((await monthRows()).map(r => [r.month, r.costUsd, r.runs])).toEqual([
          [lastMonth, 3, 9],
          [thisMonth(), 0.5, 1],
        ])
      })

      it("writes nothing and checks nothing without the run's usage, and checks no level for a run that spent nothing", async () => {
        await seedJob()

        await finishJobRun(JOB, 'boom')
        expect(await monthRows()).toEqual([])

        await finishJobRun(JOB, null, emptyUsage())
        expect((await monthRows()).map(r => [r.costUsd, r.runs])).toEqual([[0, 1]])
        expect(mockChecks.checkSpendWarnings).not.toHaveBeenCalled()
      })

      it("adds nothing for a chain's run: its steps' runs carry its spend", async () => {
        await prisma.jobRun.create({ data: { jobName: 'daily_edition_chain', cronExpression: '0 23 * * *' } })

        await finishJobRun('daily_edition_chain', null, spent(2, 1, 100))

        expect(await monthRows()).toEqual([])
        expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'daily_edition_chain' } })).lastRunUsage).toMatchObject({ costUsd: 2 })
      })

      it('finishes the run when the warning check fails', async () => {
        await seedJob()
        await claimJobRun(JOB)
        mockChecks.checkSpendWarnings.mockRejectedValueOnce(new Error('notices table gone'))

        await expect(finishJobRun(JOB, null, spent(0.5, 0, 0))).resolves.toBeUndefined()

        const job = await row()
        expect(job.lastSucceededAt).not.toBeNull()
        expect(job.lockedBy).toBeNull()
        expect(await monthRows()).toHaveLength(1)
      })
    })

    it('starts the count of interrupted runs again, on success and on failure', async () => {
      for (const error of [null, 'boom']) {
        await prisma.jobRun.deleteMany()
        await seedJob()
        await prisma.jobRun.update({ where: { jobName: JOB }, data: { interruptedRuns: 2 } })
        await claimJobRun(JOB)

        await finishJobRun(JOB, error)

        expect((await row()).interruptedRuns).toBe(0)
      }
    })
  })

  describe('recordInterruptedHere (graceful shutdown)', () => {
    /** A run this process started `minutesAgo` minutes ago and still holds. */
    async function seedRunningHere(jobName: string, minutesAgo: number) {
      await prisma.jobRun.create({ data: { jobName, cronExpression: '0 * * * *' } })
      await claimJobRun(jobName)
      await prisma.$executeRaw`
        UPDATE job_runs SET last_started_at = (now() AT TIME ZONE 'UTC') - make_interval(mins => ${minutesAgo}::int)
        WHERE job_name = ${jobName}`
    }

    it('records the reason with the minutes the run had been going, finishes it, counts it and clears the lease', async () => {
      await seedRunningHere(JOB, 12)
      await prisma.jobRun.update({ where: { jobName: JOB }, data: { interruptedRuns: 1 } })

      expect(await recordInterruptedHere([JOB], 'cut off %s min in')).toEqual([JOB])

      const job = await row()
      expect(job.lastError).toBe('cut off 12 min in')
      expect(job.lastCompletedAt!.getTime()).toBeGreaterThan(job.lastStartedAt!.getTime())
      expect(job.lastSucceededAt).toBeNull()
      expect(job.interruptedRuns).toBe(2)
      expect(job.lockedBy).toBeNull()
      expect(job.lockedUntil).toBeNull()
    })

    it('never records a run this process does not hold, nor a job it was not given', async () => {
      await seedJob({ by: 'other-host:1:abc', secondsFromNow: 600 })
      await seedRunningHere('assess_stories', 3)

      expect(await recordInterruptedHere([JOB], 'cut off %s min in')).toEqual([])

      const theirs = await row()
      expect(theirs.lastError).toBeNull()
      expect(theirs.interruptedRuns).toBe(0)
      expect(theirs.lockedBy).toBe('other-host:1:abc')
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'assess_stories' } })).lockedBy).toBe(LEASE_HOLDER)
    })

    it('asks nothing of the database for no jobs', async () => {
      expect(await recordInterruptedHere([], 'cut off %s min in')).toEqual([])
    })
  })

  describe('recordAbandonedRuns (boot sweep)', () => {
    const ago = (minutes: number | null) => (minutes === null ? null : new Date(Date.now() - minutes * 60_000))

    /** A row whose run started and finished the given minutes ago, with another process's lease running `leaseSeconds` from now. */
    async function seedRun(
      jobName: string,
      { startedMinutesAgo, completedMinutesAgo, leaseSeconds }: { startedMinutesAgo: number | null; completedMinutesAgo: number | null; leaseSeconds?: number },
    ) {
      await prisma.jobRun.create({
        data: { jobName, cronExpression: '0 * * * *', lastStartedAt: ago(startedMinutesAgo), lastCompletedAt: ago(completedMinutesAgo) },
      })
      if (leaseSeconds === undefined) return
      await prisma.$executeRaw`
        UPDATE job_runs SET locked_by = 'other-host:1:abc',
          locked_until = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${leaseSeconds}::int)
        WHERE job_name = ${jobName}`
    }

    it('records every run that started, never finished and holds no live lease, naming its start', async () => {
      await seedRun('died', { startedMinutesAgo: 80, completedMinutesAgo: 60 * 24 })
      await seedRun('died_first_run', { startedMinutesAgo: 30, completedMinutesAgo: null })
      await seedRun('died_lease_expired', { startedMinutesAgo: 5, completedMinutesAgo: 60, leaseSeconds: -10 })
      await seedRun('running_elsewhere', { startedMinutesAgo: 5, completedMinutesAgo: 60, leaseSeconds: 100 })
      await seedRun('finished', { startedMinutesAgo: 60, completedMinutesAgo: 50 })
      await seedRun('never_ran', { startedMinutesAgo: null, completedMinutesAgo: null })

      const recorded = await recordAbandonedRuns('started %s')

      expect(recorded.sort()).toEqual(['died', 'died_first_run', 'died_lease_expired'])
      const died = await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'died' } })
      const [started] = await prisma.$queryRaw<{ text: string }[]>`
        SELECT to_char(last_started_at, 'YYYY-MM-DD HH24:MI') AS text FROM job_runs WHERE job_name = 'died'`
      expect(died.lastError).toBe(`started ${started!.text}`)
      expect(died.lastCompletedAt!.getTime()).toBeGreaterThan(died.lastStartedAt!.getTime())
      expect(died.interruptedRuns).toBe(1)
      const expired = await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'died_lease_expired' } })
      expect(expired.lockedBy).toBeNull()
      expect(expired.lockedUntil).toBeNull()

      for (const jobName of ['running_elsewhere', 'finished', 'never_ran']) {
        const untouched = await prisma.jobRun.findUniqueOrThrow({ where: { jobName } })
        expect(untouched.lastError).toBeNull()
        expect(untouched.interruptedRuns).toBe(0)
      }
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'running_elsewhere' } })).lockedBy).toBe('other-host:1:abc')
    })

    it('leaves a run this process holds, and records a dead run only once', async () => {
      await prisma.jobRun.create({ data: { jobName: 'mine', cronExpression: '0 * * * *' } })
      await claimJobRun('mine')
      await seedRun('died', { startedMinutesAgo: 10, completedMinutesAgo: null })

      expect(await recordAbandonedRuns('started %s')).toEqual(['died'])
      expect(await recordAbandonedRuns('started %s')).toEqual([])
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'died' } })).interruptedRuns).toBe(1)
    })
  })

  it('interruptedJobRuns lists the interrupted jobs with their count and reason; clearInterruptedRuns starts a count again', async () => {
    await prisma.jobRun.createMany({
      data: [
        { jobName: 'twice', cronExpression: '0 * * * *', interruptedRuns: 2, lastError: 'Interrupted: twice' },
        { jobName: 'once', cronExpression: '0 * * * *', interruptedRuns: 1, lastError: 'Interrupted: once' },
        { jobName: 'fine', cronExpression: '0 * * * *' },
      ],
    })

    const listed = await interruptedJobRuns()
    expect(listed.sort((a, b) => a.jobName.localeCompare(b.jobName))).toEqual([
      { jobName: 'once', interruptedRuns: 1, lastError: 'Interrupted: once' },
      { jobName: 'twice', interruptedRuns: 2, lastError: 'Interrupted: twice' },
    ])

    await clearInterruptedRuns('twice')
    expect((await interruptedJobRuns()).map(job => job.jobName)).toEqual(['once'])
    // The reason stays on the row for the Jobs page
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'twice' } })).lastError).toBe('Interrupted: twice')
  })

  it('jobsWithLiveLease lists live leases only, whoever holds them', async () => {
    await prisma.jobRun.createMany({
      data: [
        { jobName: 'live_mine', cronExpression: '0 * * * *' },
        { jobName: 'live_theirs', cronExpression: '0 * * * *' },
        { jobName: 'expired', cronExpression: '0 * * * *' },
        { jobName: 'free', cronExpression: '0 * * * *' },
      ],
    })
    await claimJobRun('live_mine')
    await prisma.$executeRaw`
      UPDATE job_runs SET locked_by = 'other', locked_until = (now() AT TIME ZONE 'UTC') + interval '1 minute'
      WHERE job_name = 'live_theirs'`
    await prisma.$executeRaw`
      UPDATE job_runs SET locked_by = 'other', locked_until = (now() AT TIME ZONE 'UTC') - interval '1 minute'
      WHERE job_name = 'expired'`

    expect([...(await jobsWithLiveLease())].sort()).toEqual(['live_mine', 'live_theirs'])
  })

  it('releaseHeldJobLeases clears only the leases this process holds', async () => {
    await prisma.jobRun.createMany({
      data: [
        { jobName: 'mine', cronExpression: '0 * * * *' },
        { jobName: 'theirs', cronExpression: '0 * * * *' },
      ],
    })
    await claimJobRun('mine')
    await prisma.$executeRaw`
      UPDATE job_runs SET locked_by = 'other', locked_until = (now() AT TIME ZONE 'UTC') + interval '1 minute'
      WHERE job_name = 'theirs'`

    expect(await releaseHeldJobLeases()).toBe(1)
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'mine' } })).lockedBy).toBeNull()
    expect((await prisma.jobRun.findUniqueOrThrow({ where: { jobName: 'theirs' } })).lockedBy).toBe('other')
  })
})
