import { hostname } from 'os'
import { randomUUID } from 'crypto'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'

/**
 * The cross-instance job lease (ADR-0017): a run holds `locked_by`/`locked_until` on its job's
 * `job_runs` row, so two processes (old and new instance during a zero-downtime deploy, or a second
 * process against the same database) never run the same job at once. Every statement is raw SQL on
 * the database clock (`locked_until` is `timestamp without time zone` holding UTC, like the podcast
 * lease), which also keeps this working whether or not the generated Prisma client knows the columns.
 */

const log = createLogger('job-lease')

/** This process's lease holder id, readable in `job_runs.locked_by` when debugging. */
export const LEASE_HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`

/**
 * Start a run: take the job's lease and stamp `last_started_at` (clearing `last_error`) in one
 * statement. 'held' while another process's lease is live; throws when the job has no row.
 */
export async function claimJobRun(jobName: string): Promise<'claimed' | 'held'> {
  const claimed = await prisma.$executeRaw`
    UPDATE "job_runs"
    SET "locked_by" = ${LEASE_HOLDER},
        "locked_until" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${config.scheduler.leaseSeconds}::int),
        "last_started_at" = (now() AT TIME ZONE 'UTC'),
        "last_error" = NULL,
        "updated_at" = (now() AT TIME ZONE 'UTC')
    WHERE "job_name" = ${jobName}
      AND ("locked_until" IS NULL OR "locked_until" < (now() AT TIME ZONE 'UTC') OR "locked_by" = ${LEASE_HOLDER})`
  if (claimed > 0) return 'claimed'

  const row = await prisma.jobRun.findUnique({ where: { jobName }, select: { id: true } })
  if (!row) throw new Error(`job ${jobName} has no job_runs row`)
  return 'held'
}

/** Extend this process's lease on the job; false when it no longer holds it. */
async function renewJobLease(jobName: string): Promise<boolean> {
  const renewed = await prisma.$executeRaw`
    UPDATE "job_runs"
    SET "locked_until" = (now() AT TIME ZONE 'UTC') + make_interval(secs => ${config.scheduler.leaseSeconds}::int)
    WHERE "job_name" = ${jobName} AND "locked_by" = ${LEASE_HOLDER}`
  return renewed > 0
}

/**
 * Run `fn` while renewing the job's lease every `leaseRenewMs`. A lost lease warns once and stops
 * renewing; `fn` carries on (handlers are not cancellable). Renewal stops when `fn` settles.
 */
export async function withJobLeaseHeartbeat<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  let stopped = false
  const timer = setInterval(() => {
    renewJobLease(jobName)
      .then(renewed => {
        if (renewed || stopped) return
        stopped = true
        clearInterval(timer)
        log.warn({ jobName }, 'lost the job lease')
      })
      .catch(err => log.warn({ jobName, err }, 'could not renew the job lease'))
  }, config.scheduler.leaseRenewMs)
  timer.unref()
  try {
    return await fn()
  } finally {
    stopped = true
    clearInterval(timer)
  }
}

/**
 * Finish a run: always record `last_completed_at` (and `last_succeeded_at` on success, `last_error`
 * on failure), and release the lease only where this process still holds it.
 */
export async function finishJobRun(jobName: string, error: string | null): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "job_runs"
    SET "last_completed_at" = (now() AT TIME ZONE 'UTC'),
        "last_succeeded_at" = CASE WHEN ${error === null} THEN (now() AT TIME ZONE 'UTC') ELSE "last_succeeded_at" END,
        "last_error" = ${error},
        "locked_by" = CASE WHEN "locked_by" = ${LEASE_HOLDER} THEN NULL ELSE "locked_by" END,
        "locked_until" = CASE WHEN "locked_by" = ${LEASE_HOLDER} THEN NULL ELSE "locked_until" END,
        "updated_at" = (now() AT TIME ZONE 'UTC')
    WHERE "job_name" = ${jobName}`
}

/** The jobs whose lease is live on the database clock, whichever process holds it. */
export async function jobsWithLiveLease(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ job_name: string }[]>`
    SELECT "job_name" FROM "job_runs" WHERE "locked_until" > (now() AT TIME ZONE 'UTC')`
  return new Set(rows.map(row => row.job_name))
}

/** Clear every job lease this process holds (graceful shutdown), so the next process can run them at once. */
export async function releaseHeldJobLeases(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "job_runs" SET "locked_by" = NULL, "locked_until" = NULL WHERE "locked_by" = ${LEASE_HOLDER}`
}
