import { describe, it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'
import { claimJobRun, finishJobRun, jobsWithLiveLease, LEASE_HOLDER, releaseHeldJobLeases } from './jobLease.js'

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
      expect(job.lockedUntil!.getTime()).toBeGreaterThan(Date.now())
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
