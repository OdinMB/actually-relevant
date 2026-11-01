import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockWarn = vi.hoisted(() => vi.fn())
vi.mock('./logger.js', () => ({ createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn() }) }))

const { RefreshingValue } = await import('./refreshingValue.js')

const REFRESH_MS = 60_000

/** A load whose calls resolve in order with 'v1', 'v2', … unless told to fail. */
function counter() {
  let n = 0
  return vi.fn(async () => `v${++n}`)
}

describe('RefreshingValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockWarn.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads on the first read and serves that copy to later reads within the interval', async () => {
    const load = counter()
    const value = new RefreshingValue('t', REFRESH_MS, load)

    expect(await value.get()).toBe('v1')
    vi.advanceTimersByTime(REFRESH_MS - 1)
    expect(await value.get()).toBe('v1')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('serves the old copy at once when it is due and refreshes it in the background', async () => {
    const load = counter()
    const value = new RefreshingValue('t', REFRESH_MS, load)
    await value.get()

    vi.advanceTimersByTime(REFRESH_MS)
    expect(await value.get()).toBe('v1')
    await vi.runOnlyPendingTimersAsync()
    expect(await value.get()).toBe('v2')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one load between concurrent first reads', async () => {
    const load = counter()
    const value = new RefreshingValue('t', REFRESH_MS, load)

    const [a, b] = await Promise.all([value.get(), value.get()])
    expect([a, b]).toEqual(['v1', 'v1'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('start() loads at once and again every interval, without visitors', async () => {
    const load = counter()
    const value = new RefreshingValue('t', REFRESH_MS, load)

    value.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)
    expect(load).toHaveBeenCalledTimes(3)
    expect(await value.get()).toBe('v3')

    value.stop()
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('keeps serving the last copy when a refresh fails, and logs it', async () => {
    const load = vi.fn().mockResolvedValueOnce('v1').mockRejectedValueOnce(new Error('db down'))
    const value = new RefreshingValue('t', REFRESH_MS, load)
    await value.get()

    await value.refresh()
    expect(await value.get()).toBe('v1')
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('rejects the first read when there is no copy to fall back on', async () => {
    const value = new RefreshingValue('t', REFRESH_MS, vi.fn().mockRejectedValue(new Error('db down')))
    await expect(value.get()).rejects.toThrow('db down')
    expect(value.size).toBe(0)
  })

  it('clear() drops the copy so the next read waits for a fresh load, and disowns a load in flight', async () => {
    let release: (v: string) => void = () => {}
    const load = vi
      .fn()
      .mockResolvedValueOnce('v1')
      .mockImplementationOnce(() => new Promise<string>(r => (release = r)))
      .mockResolvedValueOnce('v3')
    const value = new RefreshingValue('t', REFRESH_MS, load)
    await value.get()

    const stale = value.refresh()
    value.clear()
    expect(value.size).toBe(0)
    release('v2')
    await stale
    expect(value.size).toBe(0)
    expect(await value.get()).toBe('v3')
  })
})
