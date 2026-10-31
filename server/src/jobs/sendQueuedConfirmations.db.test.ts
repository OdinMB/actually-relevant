import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'

// No email leaves the test: the Plunk client is a mock that records what would be sent
const mockSendTransactional = vi.hoisted(() => vi.fn())
vi.mock('../services/plunk.js', () => ({ sendTransactional: mockSendTransactional }))
vi.mock('../lib/notify.js', () => ({ notify: vi.fn() }))

const { runSendQueuedConfirmations } = await import('./sendQueuedConfirmations.js')

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const { globalHourlyMax, confirmTokenExpiryHours } = config.subscribe

/** A row whose confirmation email went out `ageMs` ago. */
async function sent(email: string, ageMs: number, confirmed = false) {
  const at = new Date(Date.now() - ageMs)
  return prisma.pendingSubscription.create({
    data: { email, token: randomUUID(), createdAt: at, sentAt: at, expiresAt: new Date(at.getTime() + 24 * HOUR_MS), confirmedAt: confirmed ? at : null },
  })
}

/** A signup that has waited `ageMs` for its email, expiring a link lifetime after it was made. */
async function queued(email: string, ageMs: number) {
  const at = new Date(Date.now() - ageMs)
  return prisma.pendingSubscription.create({
    data: { email, token: randomUUID(), createdAt: at, sentAt: null, expiresAt: new Date(at.getTime() + confirmTokenExpiryHours * HOUR_MS) },
  })
}

const sentTo = () => mockSendTransactional.mock.calls.map(([opts]) => (opts as { to: string }).to)

describeDb('runSendQueuedConfirmations (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    config.subscribe.enabled = true
    mockSendTransactional.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    config.subscribe.enabled = false
  })

  it('sends the oldest waiting signups first, up to the room left in the hour', async () => {
    for (let i = 0; i < globalHourlyMax - 2; i++) await sent(`s${i}@example.com`, 20 * MINUTE_MS)
    await queued('third@example.com', 30 * MINUTE_MS)
    await queued('first@example.com', 50 * MINUTE_MS)
    await queued('fourth@example.com', 20 * MINUTE_MS)
    await queued('second@example.com', 40 * MINUTE_MS)

    await runSendQueuedConfirmations()

    expect(sentTo()).toEqual(['first@example.com', 'second@example.com'])
    const rows = await prisma.pendingSubscription.findMany({
      where: { email: { in: ['first@example.com', 'second@example.com', 'third@example.com', 'fourth@example.com'] } },
    })
    const byEmail = new Map(rows.map(row => [row.email, row]))
    for (const email of ['first@example.com', 'second@example.com']) {
      const row = byEmail.get(email)
      expect(row?.sentAt).not.toBeNull()
      // The link lives a full lifetime from its email, not from the signup
      expect(row?.expiresAt.getTime() ?? 0).toBeGreaterThan(Date.now() + (confirmTokenExpiryHours * HOUR_MS - MINUTE_MS))
    }
    expect(byEmail.get('third@example.com')?.sentAt).toBeNull()
    expect(byEmail.get('fourth@example.com')?.sentAt).toBeNull()
  })

  it('sends with the token stored for the signup', async () => {
    const row = await queued('a@example.com', 5 * MINUTE_MS)

    await runSendQueuedConfirmations()

    expect((mockSendTransactional.mock.calls[0][0] as { body: string }).body).toContain(`token=${row.token}`)
  })

  it('sends nothing while the last hour already holds the limit', async () => {
    for (let i = 0; i < globalHourlyMax; i++) await sent(`s${i}@example.com`, 30 * MINUTE_MS)
    await sent('old@example.com', HOUR_MS + MINUTE_MS)
    await queued('waiting@example.com', 10 * MINUTE_MS)

    await runSendQueuedConfirmations()

    expect(mockSendTransactional).not.toHaveBeenCalled()
    expect((await prisma.pendingSubscription.findFirst({ where: { email: 'waiting@example.com' } }))?.sentAt).toBeNull()
  })

  it('removes, unsent, a signup that waited past its expiry', async () => {
    await queued('stale@example.com', (confirmTokenExpiryHours + 1) * HOUR_MS)
    await queued('fresh@example.com', 10 * MINUTE_MS)

    await runSendQueuedConfirmations()

    expect(sentTo()).toEqual(['fresh@example.com'])
    expect(await prisma.pendingSubscription.count({ where: { email: 'stale@example.com' } })).toBe(0)
  })

  it('removes, unsent, a waiting signup whose address confirmed meanwhile', async () => {
    const earlier = await sent('a@example.com', 3 * HOUR_MS)
    await queued('a@example.com', 10 * MINUTE_MS)
    await prisma.pendingSubscription.update({ where: { id: earlier.id }, data: { confirmedAt: new Date(Date.now() - MINUTE_MS) } })

    await runSendQueuedConfirmations()

    expect(mockSendTransactional).not.toHaveBeenCalled()
    const rows = await prisma.pendingSubscription.findMany({ where: { email: 'a@example.com' } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.confirmedAt).not.toBeNull()
  })

  it('sends a waiting signup whose address confirmed only before it signed up, and keeps that confirmed row', async () => {
    const before = await sent('back@example.com', 30 * 24 * HOUR_MS, true)
    const waiting = await queued('back@example.com', 10 * MINUTE_MS)

    await runSendQueuedConfirmations()

    expect(sentTo()).toEqual(['back@example.com'])
    expect((await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: waiting.id } })).sentAt).not.toBeNull()
    expect(await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
  })

  it('leaves rows already sent alone', async () => {
    const row = await sent('a@example.com', 2 * HOUR_MS)

    await runSendQueuedConfirmations()

    expect(mockSendTransactional).not.toHaveBeenCalled()
    expect(await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row)
  })

  it('counts a row written without sent_at as sent, so the release before this one is never sent twice during a deploy', async () => {
    await prisma.$executeRaw`
      INSERT INTO "pending_subscriptions" ("id", "email", "token", "expires_at")
      VALUES (${randomUUID()}, 'previous@example.com', ${randomUUID()}, NOW() + INTERVAL '24 hours')`

    await runSendQueuedConfirmations()

    expect(mockSendTransactional).not.toHaveBeenCalled()
    expect((await prisma.pendingSubscription.findFirst({ where: { email: 'previous@example.com' } }))?.sentAt).not.toBeNull()
  })

  it('keeps a signup waiting, for the next run, when Plunk could not be reached', async () => {
    const row = await queued('a@example.com', 10 * MINUTE_MS)
    mockSendTransactional.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))

    await expect(runSendQueuedConfirmations()).rejects.toThrow()

    const after = await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: row.id } })
    expect(after.sentAt).toBeNull()
    expect(after.expiresAt).toEqual(row.expiresAt)
  })

  it('removes a signup Plunk refuses as invalid, sends the one behind it, and the next run never tries it again', async () => {
    const refused = await queued('refused@example.com', 30 * MINUTE_MS)
    const next = await queued('next@example.com', 20 * MINUTE_MS)
    mockSendTransactional.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 422'), { response: { status: 422 } }))

    await expect(runSendQueuedConfirmations()).rejects.toThrow('1 queued signup refused by Plunk (HTTP 422) and removed')

    expect(sentTo()).toEqual(['refused@example.com', 'next@example.com'])
    expect(await prisma.pendingSubscription.count({ where: { id: refused.id } })).toBe(0)
    expect((await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: next.id } })).sentAt).not.toBeNull()

    mockSendTransactional.mockClear()
    await runSendQueuedConfirmations()
    expect(mockSendTransactional).not.toHaveBeenCalled()
  })
})
