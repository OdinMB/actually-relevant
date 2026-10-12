import { describe, it, expect, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'

const { config } = await import('../config.js')
const { hashFeedbackIp } = await import('./feedbackIpHash.js')

describe('hashFeedbackIp', () => {
  const originalSecret = config.feedback.ipHashSecret

  afterEach(() => {
    config.feedback.ipHashSecret = originalSecret
  })

  it('returns the HMAC-SHA256 of the address under the secret, not its plain SHA-256', () => {
    config.feedback.ipHashSecret = 'secret-one'

    const hash = hashFeedbackIp('198.51.100.4')

    expect(hash).toBe(createHmac('sha256', 'secret-one').update('198.51.100.4').digest('hex'))
    expect(hash).not.toBe(createHash('sha256').update('198.51.100.4').digest('hex'))
  })

  it('gives different hashes for the same address under different secrets', () => {
    config.feedback.ipHashSecret = 'secret-one'
    const first = hashFeedbackIp('198.51.100.4')
    config.feedback.ipHashSecret = 'secret-two'
    const second = hashFeedbackIp('198.51.100.4')

    expect(first).not.toBe(second)
  })

  it('returns null when no secret is set, so nothing unkeyed is ever stored', () => {
    config.feedback.ipHashSecret = ''

    expect(hashFeedbackIp('198.51.100.4')).toBeNull()
  })
})
