import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Secret must be set before config.js is first imported.
process.env.FORM_TOKEN_SECRET = 'test-form-token-secret'

const { issueFormToken, verifyFormToken } = await import('./formToken.js')
const { config } = await import('../config.js')

const MIN = config.subscribe.minFormFillMs
const MAX = config.subscribe.formTokenMaxAgeMs

describe('formToken', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a token presented after the minimum fill time and within max age', () => {
    const token = issueFormToken()
    vi.advanceTimersByTime(MIN + 1000)
    expect(verifyFormToken(token)).toEqual({ ok: true })
  })

  it('rejects a token submitted faster than the minimum fill time', () => {
    const token = issueFormToken()
    vi.advanceTimersByTime(Math.max(0, MIN - 200))
    expect(verifyFormToken(token).ok).toBe(false)
  })

  it('rejects a token older than the max age', () => {
    const token = issueFormToken()
    vi.advanceTimersByTime(MAX + 1000)
    expect(verifyFormToken(token).ok).toBe(false)
  })

  it('rejects a token with a tampered signature', () => {
    const token = issueFormToken()
    vi.advanceTimersByTime(MIN + 1000)
    const [payload] = token.split('.')
    expect(verifyFormToken(`${payload}.deadbeef`).ok).toBe(false)
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = issueFormToken()
    vi.advanceTimersByTime(MIN + 1000)
    const [, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ts: Date.now(), nonce: 'x' })).toString('base64url')
    expect(verifyFormToken(`${forged}.${sig}`).ok).toBe(false)
  })

  it('rejects malformed and empty tokens', () => {
    expect(verifyFormToken(undefined).ok).toBe(false)
    expect(verifyFormToken('').ok).toBe(false)
    expect(verifyFormToken('no-dot').ok).toBe(false)
    expect(verifyFormToken('a.b.c').ok).toBe(false)
  })
})
