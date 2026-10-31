import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'

// No email leaves the test and Plunk is never called: the client is a mock that records what would
// be sent and answers the contact lookup as each test says
const mockPlunk = vi.hoisted(() => ({
  findContactsByEmail: vi.fn(),
  hasComplaintOrBounce: vi.fn(),
  verifyEmail: vi.fn(),
  sendTransactional: vi.fn(),
  createContact: vi.fn(),
}))
vi.mock('./plunk.js', () => mockPlunk)
vi.mock('../lib/notify.js', () => ({ notify: vi.fn(async () => {}) }))

const { subscribe, confirmSubscription } = await import('./subscribe.js')
const { runSendQueuedConfirmations } = await import('../jobs/sendQueuedConfirmations.js')

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const READER = 'reader@example.com'

/** The reader's signup from long ago, confirmed: what is left of it once they unsubscribed through Plunk's link. */
async function confirmedLongAgo(email = READER) {
  const at = new Date(Date.now() - 60 * DAY_MS)
  return prisma.pendingSubscription.create({
    data: { email, token: randomUUID(), plunkContactId: 'contact-1', createdAt: at, sentAt: at, expiresAt: new Date(at.getTime() + DAY_MS), confirmedAt: at },
  })
}

/** What Plunk answers when asked about the address. */
function plunkHas(contacts: { subscribed: boolean }[]) {
  mockPlunk.findContactsByEmail.mockResolvedValue(contacts.map(c => ({ id: 'contact-1', email: READER, snoozedUntil: null, ...c })))
}

const sentTo = () => mockPlunk.sendTransactional.mock.calls.map(([opts]) => (opts as { to: string }).to)

/** The token in the confirmation link of the last email sent. */
function tokenInLastEmail(): string {
  const body = (mockPlunk.sendTransactional.mock.calls.at(-1)?.[0] as { body: string }).body
  const token = /[?&]token=([0-9a-f-]+)/.exec(body)?.[1]
  if (!token) throw new Error('no token in the confirmation email')
  return token
}

const rowsFor = (email = READER) => prisma.pendingSubscription.findMany({ where: { email }, orderBy: { createdAt: 'asc' } })

describeDb('a returning reader signs up again (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    config.subscribe.enabled = true
    mockPlunk.findContactsByEmail.mockReset()
    mockPlunk.hasComplaintOrBounce.mockReset().mockResolvedValue(false)
    mockPlunk.verifyEmail.mockReset().mockResolvedValue({ valid: true, domainExists: true, isDisposable: false })
    mockPlunk.sendTransactional.mockReset().mockResolvedValue(undefined)
    mockPlunk.createContact.mockReset().mockResolvedValue({ id: 'contact-1' })
  })
  afterEach(() => {
    config.subscribe.enabled = false
  })

  it('gets a confirmation email once Plunk has them unsubscribed, and confirming it subscribes them again', async () => {
    const earlier = await confirmedLongAgo()
    plunkHas([{ subscribed: false }])

    await subscribe({ email: 'Reader@Example.com' })

    expect(sentTo()).toEqual([READER])
    const rows = await rowsFor()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(earlier)
    expect(rows[1]).toMatchObject({ confirmedAt: null, sentAt: expect.any(Date) })

    await confirmSubscription(tokenInLastEmail(), READER)

    expect(mockPlunk.createContact).toHaveBeenCalledWith({ email: READER, subscribed: true })
    const confirmed = await prisma.pendingSubscription.findUniqueOrThrow({ where: { id: rows[1]?.id } })
    expect(confirmed.confirmedAt).not.toBeNull()
    expect(confirmed.plunkContactId).toBe('contact-1')

    // Subscribed again: a further signup sends and writes nothing
    plunkHas([{ subscribed: true }])
    await subscribe({ email: READER })
    expect(mockPlunk.sendTransactional).toHaveBeenCalledTimes(1)
    expect(await rowsFor()).toHaveLength(2)
  })

  it('gets a confirmation email when Plunk no longer has a contact for the address', async () => {
    await confirmedLongAgo()
    plunkHas([])

    await subscribe({ email: READER })

    expect(sentTo()).toEqual([READER])
    expect(await rowsFor()).toHaveLength(2)
  })

  it('gets nothing, and nothing is written, while Plunk still has them subscribed', async () => {
    const earlier = await confirmedLongAgo()
    plunkHas([{ subscribed: true }])

    await subscribe({ email: READER })

    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect(await rowsFor()).toEqual([earlier])
  })

  it('gets nothing, and nothing is written, when Plunk has a spam complaint or a bounce on record for them', async () => {
    const earlier = await confirmedLongAgo()
    plunkHas([{ subscribed: false }])
    mockPlunk.hasComplaintOrBounce.mockResolvedValue(true)

    await subscribe({ email: READER })

    expect(mockPlunk.hasComplaintOrBounce).toHaveBeenCalledWith('contact-1')
    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect(await rowsFor()).toEqual([earlier])
  })

  it("gets nothing, and nothing is written, when their contact's activity cannot be read", async () => {
    const earlier = await confirmedLongAgo()
    plunkHas([{ subscribed: false }])
    mockPlunk.hasComplaintOrBounce.mockRejectedValue(new Error('unrecognized Plunk activity response shape (keys: ["results"])'))

    await subscribe({ email: READER })

    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect(await rowsFor()).toEqual([earlier])
  })

  it('gets nothing, and nothing is written, when Plunk cannot be asked', async () => {
    const earlier = await confirmedLongAgo()
    mockPlunk.findContactsByEmail.mockRejectedValue(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }))

    await subscribe({ email: READER })

    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect(await rowsFor()).toEqual([earlier])
  })

  it('gets one email however often they sign up within the per-address window', async () => {
    await confirmedLongAgo()
    plunkHas([{ subscribed: false }])

    await subscribe({ email: READER })
    await subscribe({ email: READER })

    expect(sentTo()).toEqual([READER])
    expect(await rowsFor()).toHaveLength(2)
  })

  it('is queued over the hourly limit, and the queue job sends their email instead of dropping it', async () => {
    await confirmedLongAgo()
    const halfHourAgo = new Date(Date.now() - HOUR_MS / 2)
    await prisma.pendingSubscription.createMany({
      data: Array.from({ length: config.subscribe.globalHourlyMax }, (_, i) => ({
        email: `s${i}@example.com`,
        token: randomUUID(),
        createdAt: halfHourAgo,
        sentAt: halfHourAgo,
        expiresAt: new Date(halfHourAgo.getTime() + DAY_MS),
      })),
    })
    plunkHas([{ subscribed: false }])

    await subscribe({ email: READER })

    expect(mockPlunk.sendTransactional).not.toHaveBeenCalled()
    expect((await rowsFor())[1]).toMatchObject({ confirmedAt: null, sentAt: null })

    // The hour passes: the queue job has room again
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS)
    await prisma.pendingSubscription.updateMany({ where: { email: { not: READER } }, data: { createdAt: twoHoursAgo, sentAt: twoHoursAgo } })
    await runSendQueuedConfirmations()

    expect(sentTo()).toEqual([READER])
    await confirmSubscription(tokenInLastEmail(), READER)
    expect((await rowsFor()).every(row => row.confirmedAt !== null)).toBe(true)
  })
})
