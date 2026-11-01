import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS } from '../../../client/src/lib/formToken.js'

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
    const token = issueFormToken('subscribe')
    vi.advanceTimersByTime(MIN + 1000)
    expect(verifyFormToken(token, 'subscribe')).toEqual({ ok: true })
  })

  it('accepts a feedback token on the feedback form', () => {
    const token = issueFormToken('feedback')
    vi.advanceTimersByTime(MIN + 1000)
    expect(verifyFormToken(token, 'feedback')).toEqual({ ok: true })
  })

  it('rejects a token issued for another form', () => {
    const signup = issueFormToken('subscribe')
    const feedback = issueFormToken('feedback')
    vi.advanceTimersByTime(MIN + 1000)
    expect(verifyFormToken(signup, 'feedback').ok).toBe(false)
    expect(verifyFormToken(feedback, 'subscribe').ok).toBe(false)
  })

  it('rejects a token submitted faster than the minimum fill time', () => {
    const token = issueFormToken('subscribe')
    vi.advanceTimersByTime(Math.max(0, MIN - 200))
    expect(verifyFormToken(token, 'subscribe').ok).toBe(false)
  })

  it('rejects a token older than the max age', () => {
    const token = issueFormToken('subscribe')
    vi.advanceTimersByTime(MAX + 1000)
    expect(verifyFormToken(token, 'subscribe').ok).toBe(false)
  })

  it('rejects a token with a tampered signature', () => {
    const token = issueFormToken('subscribe')
    vi.advanceTimersByTime(MIN + 1000)
    const [payload] = token.split('.')
    expect(verifyFormToken(`${payload}.deadbeef`, 'subscribe').ok).toBe(false)
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = issueFormToken('subscribe')
    vi.advanceTimersByTime(MIN + 1000)
    const [, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ts: Date.now(), nonce: 'x', form: 'feedback' })).toString('base64url')
    expect(verifyFormToken(`${forged}.${sig}`, 'feedback').ok).toBe(false)
  })

  it('rejects malformed and empty tokens', () => {
    expect(verifyFormToken(undefined, 'subscribe').ok).toBe(false)
    expect(verifyFormToken('', 'subscribe').ok).toBe(false)
    expect(verifyFormToken('no-dot', 'subscribe').ok).toBe(false)
    expect(verifyFormToken('a.b.c', 'subscribe').ok).toBe(false)
  })
})

describe("the forms' token timing (client/src/lib/formToken.ts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  // The signup and feedback forms time their tokens by copies of these two defaults, since the
  // client cannot read the server's config. A token outside the server's window is dropped while
  // the reply still says success, so a default changed on one side alone loses signups unseen.
  it("uses the server's default minimum and maximum token age", async () => {
    vi.stubEnv('SUBSCRIBE_MIN_FORM_FILL_MS', '')
    vi.stubEnv('SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS', '')
    vi.resetModules()
    const { config: defaults } = await import('../config.js')

    expect(FORM_TOKEN_MIN_AGE_MS).toBe(defaults.subscribe.minFormFillMs)
    expect(FORM_TOKEN_MAX_AGE_MS).toBe(defaults.subscribe.formTokenMaxAgeMs)
  })
})
