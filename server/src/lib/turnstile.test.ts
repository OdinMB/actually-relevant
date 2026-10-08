import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPost = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { post: mockPost } }))

const { config } = await import('../config.js')
const { verifyTurnstile } = await import('./turnstile.js')

describe('verifyTurnstile', () => {
  const originalSecret = config.subscribe.turnstileSecretKey
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    mockPost.mockReset()
    config.subscribe.turnstileSecretKey = 'test-secret'
  })

  afterEach(() => {
    config.subscribe.turnstileSecretKey = originalSecret
    process.env.NODE_ENV = originalNodeEnv
    vi.useRealTimers()
  })

  it('skips the check outside production when no secret is set', async () => {
    config.subscribe.turnstileSecretKey = ''
    process.env.NODE_ENV = 'development'

    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe('ok')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('refuses in production when no secret is set (fail closed)', async () => {
    config.subscribe.turnstileSecretKey = ''
    process.env.NODE_ENV = 'production'

    expect(await verifyTurnstile('any-token', '1.2.3.4')).toBe('unavailable')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('fails without calling Cloudflare when the token is missing or empty', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe('failed')
    expect(await verifyTurnstile('', '1.2.3.4')).toBe('failed')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('passes when siteverify says success, sending the token and the visitor IP', async () => {
    mockPost.mockResolvedValue({ data: { success: true } })

    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe('ok')
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('siteverify'),
      expect.objectContaining({ secret: 'test-secret', response: 'tok', remoteip: '1.2.3.4' }),
      expect.anything(),
    )
  })

  it('fails when siteverify rejects the token', async () => {
    mockPost.mockResolvedValue({ data: { success: false, 'error-codes': ['invalid-input-response'] } })

    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe('failed')
  })

  it('is unavailable when siteverify cannot be reached on any attempt', async () => {
    vi.useFakeTimers()
    mockPost.mockRejectedValue(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }))

    const result = verifyTurnstile('tok', '1.2.3.4')
    await vi.runAllTimersAsync()

    expect(await result).toBe('unavailable')
    expect(mockPost).toHaveBeenCalledTimes(3)
  })

  it('reuses one idempotency key across retries', async () => {
    vi.useFakeTimers()
    mockPost
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: { success: true } })

    const result = verifyTurnstile('tok', '1.2.3.4')
    await vi.runAllTimersAsync()

    expect(await result).toBe('ok')
    const keys = mockPost.mock.calls.map((call) => (call[1] as { idempotency_key: string }).idempotency_key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})
