import { it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { describeDb, useTestDatabase } from '../test/db/harness.js'

const mockNotify = vi.hoisted(() => vi.fn())
vi.mock('../lib/notify.js', () => ({ notify: mockNotify }))

const HOUR_MS = 60 * 60 * 1000
const { perAddressWindowHours, globalHourlyMax } = config.subscribe

async function pending(email: string, ageMs: number, confirmed = false) {
  const createdAt = new Date(Date.now() - ageMs)
  await prisma.pendingSubscription.create({
    data: {
      email,
      token: randomUUID(),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
      confirmedAt: confirmed ? createdAt : null,
    },
  })
}

// Only one test reaches the cap, so the module's once-per-hour alert throttle needs no reset
const { checkSendAllowance } = await import('./subscribeLimits.js')

describeDb('checkSendAllowance (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    mockNotify.mockReset().mockResolvedValue(undefined)
  })

  it('allows a first send', async () => {
    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('limits an address with an unconfirmed row inside the window', async () => {
    await pending('a@example.com', (perAddressWindowHours - 1) * HOUR_MS)
    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
    expect(await checkSendAllowance('b@example.com')).toBe('ok')
  })

  it('does not count rows older than the window, or confirmed ones', async () => {
    await pending('a@example.com', (perAddressWindowHours + 1) * HOUR_MS)
    await pending('a@example.com', HOUR_MS / 2, true)
    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('refuses at the hourly cap across addresses and alerts once', async () => {
    for (let i = 0; i < globalHourlyMax; i++) await pending(`u${i}@example.com`, 10 * 60 * 1000)

    expect(await checkSendAllowance('new@example.com')).toBe('global-cap')
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ dedupeKey: 'signup-cap' })
  })

  it('counts only the last hour toward the cap', async () => {
    for (let i = 0; i < globalHourlyMax - 1; i++) await pending(`u${i}@example.com`, 10 * 60 * 1000)
    await pending('old@example.com', HOUR_MS + 60 * 1000)

    expect(await checkSendAllowance('new@example.com')).toBe('ok')
  })
})
