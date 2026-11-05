import { describe, it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import {
  claimJobRun,
  clearInterruptedRuns,
  finishJobRun,
  interruptedJobRuns,
  jobsWithLiveLease,
  LEASE_HOLDER,
  recordAbandonedRuns,
  recordInterruptedHere,
  releaseHeldJobLeases,
} from './jobLease.js'

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
