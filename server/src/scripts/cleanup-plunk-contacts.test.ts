import { describe, it, expect } from 'vitest'
import { shouldPurgeContact } from './cleanup-plunk-contacts.js'

describe('shouldPurgeContact', () => {
  const confirmed = new Set(['real@example.com'])

  it('purges an unsubscribed contact that never confirmed locally', () => {
    expect(shouldPurgeContact({ email: 'bot@example.com', subscribed: false }, confirmed)).toBe(true)
  })

  it('keeps subscribed contacts even if not in the confirmed set', () => {
    expect(shouldPurgeContact({ email: 'sub@example.com', subscribed: true }, confirmed)).toBe(false)
  })

  it('keeps an unsubscribed contact that confirmed locally (e.g. later unsubscribed)', () => {
    expect(shouldPurgeContact({ email: 'real@example.com', subscribed: false }, confirmed)).toBe(false)
  })

  it('matches the confirmed set case-insensitively', () => {
    expect(shouldPurgeContact({ email: 'REAL@example.com', subscribed: false }, confirmed)).toBe(false)
  })
})
