import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  pendingSubscription: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
}))
const mockNotifyEvent = vi.hoisted(() => vi.fn())

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('../lib/notify.js', () => ({ notifyEvent: mockNotifyEvent }))

const { config } = await import('../config.js')

const HOUR_MS = 60 * 60 * 1000

/** A fresh module per test, so the once-per-hour alert throttle starts clean. */
async function loadModule() {
  vi.resetModules()
  return import('./subscribeLimits.js')
}

describe('checkSendAllowance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
    mockPrisma.pendingSubscription.findFirst.mockResolvedValue(null)
    mockPrisma.pendingSubscription.count.mockResolvedValue(0)
    mockNotifyEvent.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows a send when the address has no recent row and the cap is not reached', async () => {
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('limits an address that got a confirmation email within the window', async () => {
    mockPrisma.pendingSubscription.findFirst.mockResolvedValue({ id: 'p1' })
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('address-limited')
    const where = mockPrisma.pendingSubscription.findFirst.mock.calls[0][0].where
    expect(where.email).toBe('a@example.com')
    expect(where.confirmedAt).toBeNull()
    expect(where.createdAt.gt.getTime()).toBe(Date.now() - config.subscribe.perAddressWindowHours * HOUR_MS)
    expect(mockNotifyEvent).not.toHaveBeenCalled()
  })

  it('refuses at the hourly cap and alerts the owner once, without the address', async () => {
    mockPrisma.pendingSubscription.count.mockResolvedValue(config.subscribe.globalHourlyMax)
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('victim@example.com')).toBe('global-cap')
    expect(mockPrisma.pendingSubscription.count.mock.calls[0][0].where.createdAt.gt.getTime()).toBe(Date.now() - HOUR_MS)
    expect(mockNotifyEvent).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(mockNotifyEvent.mock.calls[0])).not.toContain('victim@example.com')
  })

  it('allows a send just below the cap', async () => {
    mockPrisma.pendingSubscription.count.mockResolvedValue(config.subscribe.globalHourlyMax - 1)
    const { checkSendAllowance } = await loadModule()

    expect(await checkSendAllowance('a@example.com')).toBe('ok')
  })

  it('sends no second alert within the hour, and alerts again after it', async () => {
    mockPrisma.pendingSubscription.count.mockResolvedValue(config.subscribe.globalHourlyMax)
    const { checkSendAllowance } = await loadModule()

    await checkSendAllowance('a@example.com')
    vi.setSystemTime(Date.now() + 30 * 60 * 1000)
    expect(await checkSendAllowance('b@example.com')).toBe('global-cap')
    expect(mockNotifyEvent).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + HOUR_MS)
    await checkSendAllowance('c@example.com')
    expect(mockNotifyEvent).toHaveBeenCalledTimes(2)
  })
})
