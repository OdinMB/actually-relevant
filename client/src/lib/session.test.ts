import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshSession, getAccessToken, setAccessToken } from './session'

const mockFetch = vi.fn()

function response(status: number, data: unknown = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  })
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  vi.useFakeTimers()
  setAccessToken(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('refreshSession', () => {
  it('stores the new access token on success', async () => {
    mockFetch.mockReturnValueOnce(response(200, { accessToken: 'fresh' }))

    const outcome = await refreshSession()

    expect(outcome).toEqual({ status: 'ok', accessToken: 'fresh' })
    expect(getAccessToken()).toBe('fresh')
  })

  it('reports a rejected cookie as unauthorized without retrying', async () => {
    setAccessToken('stale')
    mockFetch.mockReturnValue(response(401))

    const outcome = await refreshSession()

    expect(outcome).toEqual({ status: 'unauthorized' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
  })

  it('retries a server error or a network failure, then succeeds', async () => {
    mockFetch
      .mockReturnValueOnce(response(502))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(response(200, { accessToken: 'fresh' }))

    const pending = refreshSession()
    await vi.runAllTimersAsync()

    expect(await pending).toEqual({ status: 'ok', accessToken: 'fresh' })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('reports the server as unavailable once retries run out, keeping the session undecided', async () => {
    mockFetch.mockReturnValue(response(503))

    const pending = refreshSession()
    await vi.runAllTimersAsync()

    expect(await pending).toEqual({ status: 'unavailable' })
  })

  it('does not retry a rate-limited refresh, which only spends more of the limit', async () => {
    mockFetch.mockReturnValue(response(429))

    const outcome = await refreshSession()

    expect(outcome).toEqual({ status: 'unavailable' })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh between concurrent callers', async () => {
    mockFetch.mockReturnValueOnce(response(200, { accessToken: 'fresh' }))

    const [a, b] = await Promise.all([refreshSession(), refreshSession()])

    expect(a).toEqual(b)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
