import { it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'

const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))

const HOUR_MS = 60 * 60 * 1000
const { perAddressWindowHours, globalHourlyMax } = config.subscribe

/** A row whose confirmation email went out `ageMs` ago, as `subscribe()` writes it. */
async function pending(email: string, ageMs: number, confirmed = false) {
  const createdAt = new Date(Date.now() - ageMs)
  await prisma.pendingSubscription.create({
    data: {
      email,
      token: randomUUID(),
      createdAt,
      sentAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
      confirmedAt: confirmed ? createdAt : null,
    },
  })
}

/** A signup that has waited `ageMs` for its email; it expires a link lifetime after it was made. */
async function queued(email: string, ageMs: number) {
  const createdAt = new Date(Date.now() - ageMs)
  await prisma.pendingSubscription.create({
    data: {
      email,
      token: randomUUID(),
      createdAt,
      sentAt: null,
      expiresAt: new Date(createdAt.getTime() + config.subscribe.confirmTokenExpiryHours * HOUR_MS),
    },
  })
}

const { checkSendAllowance, remainingHourlyBudget, _resetAlertThrottles } = await import('./subscribeLimits.js')

/** The send_queued_confirmations job row; `completedMinutesAgo` is stamped on the database clock, as finishJobRun does. */
async function queueJob(enabled: boolean, completedMinutesAgo: number | null) {
  await prisma.jobRun.create({ data: { jobName: 'send_queued_confirmations', cronExpression: '*/10 * * * *', enabled } })
  if (completedMinutesAgo !== null) {
    await prisma.$executeRaw`
      UPDATE "job_runs" SET "last_completed_at" = (now() AT TIME ZONE 'UTC') - make_interval(mins => ${completedMinutesAgo}::int)
      WHERE "job_name" = 'send_queued_confirmations'`
  }
}

const stallNotices = () => mockNotify.mock.calls.filter(([notice]) => notice.dedupeKey === 'signup-queue-stalled')

describeDb('checkSendAllowance (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    mockNotify.mockReset().mockResolvedValue(undefined)
    _resetAlertThrottles()
  })

  it('allows a first send', async () => {
    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('limits an address with an unconfirmed row inside the window', async () => {
    await pending('a@example.com', (perAddressWindowHours - 1) * HOUR_MS)
    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
    expect(await checkSendAllowance('b@example.com')).toBe('ok')
  })

  it('limits an address whose signup is still waiting in the queue', async () => {
    await queued('a@example.com', 10 * 60 * 1000)
    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
  })

  it('limits an address whose queued email went out inside the window, however old the signup', async () => {
    const createdAt = new Date(Date.now() - (perAddressWindowHours + 2) * HOUR_MS)
    await prisma.pendingSubscription.create({
      data: { email: 'a@example.com', token: randomUUID(), createdAt, sentAt: new Date(Date.now() - HOUR_MS), expiresAt: new Date(Date.now() + HOUR_MS) },
    })
    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
  })

  it('does not count rows older than the window, or confirmed ones', async () => {
    await pending('a@example.com', (perAddressWindowHours + 1) * HOUR_MS)
    await pending('a@example.com', HOUR_MS / 2, true)
    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('queues at the hourly cap across addresses and alerts once', async () => {
    for (let i = 0; i < globalHourlyMax; i++) await pending(`u${i}@example.com`, 10 * 60 * 1000)

    expect(await checkSendAllowance('new@example.com')).toBe('queue')
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ dedupeKey: 'signup-cap' })
  })

  it('counts only the last hour toward the cap', async () => {
    for (let i = 0; i < globalHourlyMax - 1; i++) await pending(`u${i}@example.com`, 10 * 60 * 1000)
    await pending('old@example.com', HOUR_MS + 60 * 1000)

    expect(await checkSendAllowance('new@example.com')).toBe('ok')
  })

  it('counts a waiting signup as no sent email', async () => {
    for (let i = 0; i < globalHourlyMax; i++) await queued(`q${i}@example.com`, 10 * 60 * 1000)

    expect(await remainingHourlyBudget(new Date())).toBe(globalHourlyMax)
  })

  it('queues behind a signup still waiting, with room in the hour', async () => {
    await queued('first@example.com', 10 * 60 * 1000)

    expect(await checkSendAllowance('second@example.com')).toBe('queue')
  })

  it('does not queue behind a signup that waited past its expiry', async () => {
    await queued('stale@example.com', (config.subscribe.confirmTokenExpiryHours + 1) * HOUR_MS)

    expect(await checkSendAllowance('new@example.com')).toBe('ok')
  })

  it('raises no stall alert while the job is enabled and completed a run minutes ago', async () => {
    await queueJob(true, 5)
    await queued('first@example.com', 10 * 60 * 1000)

    expect(await checkSendAllowance('second@example.com')).toBe('queue')
    expect(stallNotices()).toHaveLength(0)
  })

  it('warns that signups are stalling when the job last completed a run longer ago than the stall limit', async () => {
    await queueJob(true, config.subscribe.queueStalledAfterMinutes + 5)
    await queued('first@example.com', 10 * 60 * 1000)

    expect(await checkSendAllowance('second@example.com')).toBe('queue')
    expect(stallNotices()).toHaveLength(1)
    expect(stallNotices()[0]?.[0].message).toMatch(/has not completed a run since .*; 1 waiting/)
  })

  it('warns that signups are stalling when the job is disabled', async () => {
    await queueJob(false, 5)
    await queued('first@example.com', 10 * 60 * 1000)

    expect(await checkSendAllowance('second@example.com')).toBe('queue')
    expect(stallNotices()[0]?.[0].message).toContain('send_queued_confirmations is disabled')
  })
})
