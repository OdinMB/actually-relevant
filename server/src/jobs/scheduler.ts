import cron from 'node-cron'
import prisma from '../lib/prisma.js'
import { createLogger } from '../lib/logger.js'
import { jobFailureNotice, notify } from '../lib/notify.js'
import { config } from '../config.js'
import { JOB_HANDLERS, JOB_PIPELINE_ORDER } from './handlers.js'
import { jobTimeZone } from './jobTimeZones.js'
import { claimJobRun, finishJobRun, jobsWithLiveLease, withJobLeaseHeartbeat } from './jobLease.js'

const log = createLogger('scheduler')

const tasksByName = new Map<string, cron.ScheduledTask>()
/** Fast path of the overlap guard within this process; the job lease (jobLease.ts) covers other processes. */
const runningJobs = new Set<string>()
/** Bumped by stopScheduler, so a boot catch-up chain started before it ends at its next step. */
let catchUpGeneration = 0

export async function initScheduler(): Promise<void> {
  log.info('initializing')

  const jobs = await prisma.jobRun.findMany()
  const overdue: string[] = []

  for (const job of jobs) {
    if (!job.enabled) {
      log.info({ jobName: job.jobName }, 'disabled, skipping')
      continue
    }

    const handler = JOB_HANDLERS[job.jobName]
    if (!handler) {
      log.warn({ jobName: job.jobName }, 'no handler found, skipping')
      continue
    }

    if (!cron.validate(job.cronExpression)) {
      log.error({ jobName: job.jobName, cronExpression: job.cronExpression }, 'invalid cron expression, skipping')
      continue
    }

    // Register cron job
    const task = scheduleJob(job.jobName, job.cronExpression, handler)
    tasksByName.set(job.jobName, task)
    log.info({ jobName: job.jobName, cronExpression: job.cronExpression }, 'registered')

    if (isOverdue(job)) overdue.push(job.jobName)
  }

  log.info({ jobCount: tasksByName.size }, 'ready')

  if (overdue.length > 0) {
    const ordered = inPipelineOrder(overdue)
    log.info({ jobs: ordered }, 'overdue at boot, catching up one after another')
    const generation = catchUpGeneration
    runCatchUp(ordered, generation).catch(err => {
      log.error({ err }, 'boot catch-up stopped; the remaining jobs wait for their schedule')
    })
  }
}

/** Sort job names by JOB_PIPELINE_ORDER; a name missing from it goes last. */
function inPipelineOrder(jobNames: string[]): string[] {
  const rank = (name: string) => {
    const index = JOB_PIPELINE_ORDER.indexOf(name)
    return index === -1 ? Infinity : index
  }
  return [...jobNames].sort((a, b) => rank(a) - rank(b))
}

/**
 * Run the boot catch-up one job at a time. Before each step the job's row is read again: a job
 * disabled meanwhile, or no longer overdue because its cron tick ran it, is skipped. A stopScheduler
 * (a new generation) ends the chain before its next step.
 */
async function runCatchUp(jobNames: string[], generation: number): Promise<void> {
  for (const jobName of jobNames) {
    if (generation !== catchUpGeneration) return
    const handler = JOB_HANDLERS[jobName]
    const job = await prisma.jobRun.findUnique({ where: { jobName } })
    if (!handler || !tasksByName.has(jobName) || !job?.enabled || !isOverdue(job)) {
      log.info({ jobName }, 'no longer due for catch-up, skipping')
      continue
    }
    log.info({ jobName }, 'overdue, running now')
    await runJob(jobName, handler)
  }
}

/**
 * Overdue at boot: more than 2x the estimated interval since the last finished run. A job that
 * never finished is not overdue; it waits for its first cron tick.
 */
function isOverdue(job: { jobName: string; lastCompletedAt: Date | null; cronExpression: string }): boolean {
  if (!job.lastCompletedAt) return false

  // Simple heuristic: parse the cron to estimate interval
  // For expressions like "0 */6 * * *", the interval is ~6 hours
  // We consider a job overdue if it hasn't run in 2x the expected interval
  const intervalMs = estimateCronIntervalMs(job.cronExpression)
  if (!intervalMs) return false

  const elapsed = Date.now() - job.lastCompletedAt.getTime()
  return elapsed > intervalMs * 2
}

function estimateCronIntervalMs(cronExpr: string): number | null {
  const parts = cronExpr.split(' ')
  if (parts.length < 5) return null

  const [, hourPart, , , dowPart] = parts

  // Base interval from hour field
  let baseHours: number | null = null

  // "*/N" pattern → every N hours
  const everyMatch = hourPart.match(/^\*\/(\d+)$/)
  if (everyMatch) baseHours = parseInt(everyMatch[1])

  // "H1,H2,H3" pattern → interval between entries
  if (baseHours === null) {
    const hours = hourPart.split(',').map(Number).filter(n => !isNaN(n))
    if (hours.length >= 2) {
      baseHours = 24 / hours.length
    }
  }

  // Single hour → daily
  if (baseHours === null && /^\d+$/.test(hourPart)) baseHours = 24

  if (baseHours === null) return null

  // Factor in day-of-week restrictions
  // If only specific days are scheduled, the actual interval between
  // runs is longer than the hour-based estimate (e.g. weekly jobs)
  const dowMultiplier = estimateDowMultiplier(dowPart)

  return baseHours * dowMultiplier * 60 * 60 * 1000
}

/**
 * Estimate how many days between runs based on the day-of-week field.
 * Returns 1 for daily schedules, 7 for weekly, etc.
 */
function estimateDowMultiplier(dowPart: string): number {
  // "*" or missing → runs every day
  if (!dowPart || dowPart === '*') return 1

  // Count how many days per week this expression covers
  const daysPerWeek = countDaysInDowExpr(dowPart)
  if (daysPerWeek === null || daysPerWeek <= 0 || daysPerWeek >= 7) return 1

  // Average gap between runs in days
  return 7 / daysPerWeek
}

function countDaysInDowExpr(expr: string): number | null {
  const days = new Set<number>()

  for (const part of expr.split(',')) {
    // Range: "1-5"
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1])
      const end = parseInt(rangeMatch[2])
      if (start <= end) {
        for (let d = start; d <= end; d++) days.add(d % 7)
      } else {
        // Wrap-around range: e.g., 5-2 = Fri,Sat,Sun,Mon,Tue
        for (let d = start; d <= 6; d++) days.add(d % 7)
        for (let d = 0; d <= end; d++) days.add(d % 7)
      }
      continue
    }
    // Single day: "6"
    if (/^\d+$/.test(part)) {
      days.add(parseInt(part) % 7)
      continue
    }
    // Unrecognized pattern (e.g. "*/2") → fall back
    return null
  }

  return days.size
}

/**
 * Run a job with bookkeeping, under the job's lease. Always resolves: a failure
 * of the handler or of any bookkeeping write is logged, recorded where possible,
 * and alerted, and the running mark is always removed. While another process
 * holds the lease the run is skipped quietly: nothing recorded, nothing alerted.
 */
async function runJob(jobName: string, handler: () => Promise<void>): Promise<void> {
  if (runningJobs.has(jobName)) {
    log.warn({ jobName }, 'already running, skipping')
    return
  }

  runningJobs.add(jobName)

  try {
    if ((await claimJobRun(jobName)) === 'held') {
      log.info({ jobName }, 'held by another process, skipping')
      return
    }
    log.info({ jobName }, 'started')
    await withJobLeaseHeartbeat(jobName, handler)
    await finishJobRun(jobName, null)
    log.info({ jobName }, 'completed')
  } catch (err) {
    let errorMsg = err instanceof Error ? err.message : String(err)
    // Prisma errors include additional details in meta (e.g. raw query DB error code/message)
    if (err && typeof err === 'object' && 'code' in err && 'meta' in err) {
      const pe = err as { code: string; meta?: Record<string, unknown> }
      if (pe.meta) errorMsg += ` | Prisma ${pe.code}: ${JSON.stringify(pe.meta)}`
    }
    log.error({ jobName, err }, 'job failed')
    await recordFailure(jobName, errorMsg)
    notify(jobFailureNotice(jobName, errorMsg)).catch(() => {})
  } finally {
    runningJobs.delete(jobName)
  }
}

/** Write the failure to the job row and release the lease; a failed write is logged, never thrown. */
async function recordFailure(jobName: string, errorMsg: string): Promise<void> {
  try {
    await finishJobRun(jobName, errorMsg)
  } catch (err) {
    log.error({ jobName, err }, 'failed to record job failure')
  }
}

/** Register the job's cron task, on its fixed time zone's clock where it has one (jobTimeZones.ts). */
function scheduleJob(jobName: string, cronExpression: string, handler: () => Promise<void>): cron.ScheduledTask {
  const tick = () => launchJob(jobName, handler)
  const timezone = jobTimeZone(jobName)
  return timezone ? cron.schedule(cronExpression, tick, { timezone }) : cron.schedule(cronExpression, tick)
}

/** Fire-and-forget trigger used by cron ticks (the boot catch-up awaits runJob in its own chain). */
function launchJob(jobName: string, handler: () => Promise<void>): void {
  runJob(jobName, handler).catch(err => {
    log.error({ jobName, err }, 'job launcher caught unexpected rejection')
  })
}

/**
 * Whether a run of the job is under way, in this process or, by a live lease, in another
 * (the admin run route answers 409 then).
 */
async function isJobRunning(jobName: string): Promise<boolean> {
  if (runningJobs.has(jobName)) return true
  return (await jobsWithLiveLease()).has(jobName)
}

// Exported for manual trigger via admin API and testing
export { runJob, runningJobs, isJobRunning, estimateCronIntervalMs }

export async function reloadJob(jobName: string): Promise<void> {
  // Stop existing task if any
  const existing = tasksByName.get(jobName)
  if (existing) existing.stop()
  tasksByName.delete(jobName)

  if (!config.scheduler.enabled) {
    log.info({ jobName }, 'scheduler disabled (SCHEDULER_ENABLED): saved, not scheduled in this process')
    return
  }

  // Read fresh config from DB
  const job = await prisma.jobRun.findUnique({ where: { jobName } })
  if (!job || !job.enabled) {
    log.info({ jobName }, 'job disabled or not found, unregistered')
    return
  }

  const handler = JOB_HANDLERS[jobName]
  if (!handler || !cron.validate(job.cronExpression)) {
    log.warn({ jobName }, 'no handler or invalid cron, not re-registering')
    return
  }

  const task = scheduleJob(jobName, job.cronExpression, handler)
  tasksByName.set(jobName, task)
  log.info({ jobName, cronExpression: job.cronExpression }, 'reloaded')
}

// Boot retry state (startScheduler / stopScheduler)
let initRetryTimer: NodeJS.Timeout | null = null
let schedulerStopped = false

/**
 * Start the scheduler, retrying with backoff while initScheduler fails (e.g.
 * the database is down at boot). Retries forever; alerts once after
 * config.scheduler.initAlertAfterAttempts failed attempts.
 */
export function startScheduler(): void {
  if (!config.scheduler.enabled) {
    log.info('scheduler disabled (SCHEDULER_ENABLED): no job is scheduled in this process')
    return
  }
  schedulerStopped = false
  void attemptStart(1, null)
}

/**
 * One start attempt. `alertedReason` is the failure the boot alert named, once one was sent: that
 * alert usually cannot be stored (the database is what is down), so a later successful start
 * records a notice in its place.
 */
async function attemptStart(attempt: number, alertedReason: string | null): Promise<void> {
  initRetryTimer = null
  if (schedulerStopped) return

  try {
    await initScheduler()
    // A shutdown that arrived while this attempt was in flight wins
    if (schedulerStopped) {
      stopScheduler()
      return
    }
    if (alertedReason !== null) {
      log.info({ attempt }, 'scheduler started after earlier failures')
      notify({
        ...jobFailureNotice('scheduler', `scheduler started after ${attempt - 1} failed attempts: ${alertedReason}`),
        title: 'Scheduler started after failures',
      }).catch(() => {})
    }
    return
  } catch (err) {
    const { initRetryBaseMs, initRetryMaxMs, initAlertAfterAttempts } = config.scheduler
    const delayMs = Math.min(initRetryBaseMs * 2 ** (attempt - 1), initRetryMaxMs)
    log.error({ err, attempt, retryInMs: delayMs }, 'scheduler initialization failed, retrying')

    let nowAlerted = alertedReason
    if (alertedReason === null && attempt >= initAlertAfterAttempts) {
      const reason = err instanceof Error ? err.message : String(err)
      nowAlerted = reason
      const retryMinutes = Math.round(initRetryMaxMs / 60_000)
      notify({
        ...jobFailureNotice('scheduler', `scheduler could not start: ${reason}; retrying (backoff up to every ${retryMinutes} min)`),
        severity: 'critical',
        title: 'Scheduler could not start',
      }).catch(() => {})
    }

    if (schedulerStopped) return
    initRetryTimer = setTimeout(() => void attemptStart(attempt + 1, nowAlerted), delayMs)
    initRetryTimer.unref()
  }
}

export function stopScheduler(): void {
  schedulerStopped = true
  catchUpGeneration++
  if (initRetryTimer) {
    clearTimeout(initRetryTimer)
    initRetryTimer = null
  }
  for (const task of tasksByName.values()) {
    task.stop()
  }
  tasksByName.clear()
}
