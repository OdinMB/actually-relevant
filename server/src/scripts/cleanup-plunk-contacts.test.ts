import { describe, it, expect } from 'vitest'
import { shouldPurgeContact } from './cleanup-plunk-contacts.js'

describe('shouldPurgeContact', () => {
  const confirmed = new Set(['real@example.com'])
  const cutoff = new Date('2026-06-01T00:00:00.000Z')
  const aged = '2026-05-10T00:00:00.000Z' // before cutoff → old enough to purge
  const recent = '2026-06-10T00:00:00.000Z' // after cutoff → too new to purge

  it('purges an aged unsubscribed contact that never confirmed locally', () => {
    expect(shouldPurgeContact({ email: 'bot@example.com', subscribed: false, createdAt: aged }, confirmed, cutoff)).toBe(true)
  })

  it('keeps an unsubscribed never-confirmed contact newer than the age cutoff', () => {
    expect(shouldPurgeContact({ email: 'fresh@example.com', subscribed: false, createdAt: recent }, confirmed, cutoff)).toBe(false)
  })

  it('keeps subscribed contacts even if aged and not in the confirmed set', () => {
    expect(shouldPurgeContact({ email: 'sub@example.com', subscribed: true, createdAt: aged }, confirmed, cutoff)).toBe(false)
  })

  it('keeps an aged unsubscribed contact that confirmed locally (e.g. later unsubscribed)', () => {
    expect(shouldPurgeContact({ email: 'real@example.com', subscribed: false, createdAt: aged }, confirmed, cutoff)).toBe(false)
  })

  it('matches the confirmed set case-insensitively', () => {
    expect(shouldPurgeContact({ email: 'REAL@example.com', subscribed: false, createdAt: aged }, confirmed, cutoff)).toBe(false)
  })

  it('keeps a contact with a missing createdAt (cannot judge age)', () => {
    expect(shouldPurgeContact({ email: 'unknown@example.com', subscribed: false }, confirmed, cutoff)).toBe(false)
  })

  it('keeps a contact with an unparseable createdAt', () => {
    expect(shouldPurgeContact({ email: 'weird@example.com', subscribed: false, createdAt: 'not-a-date' }, confirmed, cutoff)).toBe(false)
  })
})
