import { describe, it, expect } from 'vitest'
import {
  shouldPurgeContact,
  classifyContact,
  parseArgs,
  countByCreatedDay,
  DEFAULT_PROTECTED_WINDOWS,
  type PurgeRules,
} from './cleanup-plunk-contacts.js'

describe('shouldPurgeContact', () => {
  const rules: PurgeRules = {
    confirmedEmails: new Set(['real@example.com']),
    olderThan: new Date('2026-06-01T00:00:00.000Z'),
    protectedWindows: [],
  }
  const aged = '2026-05-10T00:00:00.000Z' // before cutoff → old enough to purge
  const recent = '2026-06-10T00:00:00.000Z' // after cutoff → too new to purge

  it('purges an aged unsubscribed contact that never confirmed locally', () => {
    expect(shouldPurgeContact({ email: 'bot@example.com', subscribed: false, createdAt: aged }, rules)).toBe(true)
  })

  it('keeps an unsubscribed never-confirmed contact newer than the age cutoff', () => {
    expect(shouldPurgeContact({ email: 'fresh@example.com', subscribed: false, createdAt: recent }, rules)).toBe(false)
  })

  it('keeps subscribed contacts even if aged and not in the confirmed set', () => {
    expect(shouldPurgeContact({ email: 'sub@example.com', subscribed: true, createdAt: aged }, rules)).toBe(false)
  })

  it('keeps an aged unsubscribed contact that confirmed locally (e.g. later unsubscribed)', () => {
    expect(shouldPurgeContact({ email: 'real@example.com', subscribed: false, createdAt: aged }, rules)).toBe(false)
  })

  it('matches the confirmed set case-insensitively', () => {
    expect(shouldPurgeContact({ email: 'REAL@example.com', subscribed: false, createdAt: aged }, rules)).toBe(false)
  })

  it('keeps a contact with a missing createdAt (cannot judge age)', () => {
    expect(shouldPurgeContact({ email: 'unknown@example.com', subscribed: false }, rules)).toBe(false)
  })

  it('keeps a contact with an unparseable createdAt', () => {
    expect(shouldPurgeContact({ email: 'weird@example.com', subscribed: false, createdAt: 'not-a-date' }, rules)).toBe(false)
  })
})

describe('import guard (protected creation window)', () => {
  const rules: PurgeRules = {
    confirmedEmails: new Set(['real@example.com']),
    olderThan: new Date('2026-10-01T00:00:00.000Z'),
    protectedWindows: DEFAULT_PROTECTED_WINDOWS,
  }
  const importMoment = '2026-02-15T00:36:00.000Z' // 15 Feb 2026, 01:36 Berlin

  it('keeps an unsubscribed never-confirmed contact created at the import moment', () => {
    const c = { email: 'imported@example.com', subscribed: false, createdAt: importMoment }
    expect(shouldPurgeContact(c, rules)).toBe(false)
    expect(classifyContact(c, rules)).toBe('import-window')
  })

  it('covers the whole import day in Berlin and in UTC', () => {
    for (const createdAt of ['2026-02-14T23:00:00.000Z', '2026-02-15T23:59:59.000Z']) {
      expect(shouldPurgeContact({ email: 'imported@example.com', subscribed: false, createdAt }, rules)).toBe(false)
    }
  })

  it('purges a contact created the day after the import as before', () => {
    const c = { email: 'bot@example.com', subscribed: false, createdAt: '2026-02-16T00:00:00.000Z' }
    expect(shouldPurgeContact(c, rules)).toBe(true)
  })

  it('purges a contact created just before the window', () => {
    expect(shouldPurgeContact({ email: 'bot@example.com', subscribed: false, createdAt: '2026-02-14T22:59:59.000Z' }, rules)).toBe(true)
  })

  it('reports subscribed and confirmed contacts in the window by their own reason, not the guard', () => {
    expect(classifyContact({ email: 'x@example.com', subscribed: true, createdAt: importMoment }, rules)).toBe('subscribed')
    expect(classifyContact({ email: 'real@example.com', subscribed: false, createdAt: importMoment }, rules)).toBe('confirmed')
  })

  it('reports a too-new contact as too-new even inside a window', () => {
    const r: PurgeRules = { ...rules, olderThan: new Date('2026-02-01T00:00:00.000Z') }
    expect(classifyContact({ email: 'x@example.com', subscribed: false, createdAt: importMoment }, r)).toBe('too-new')
  })
})

describe('parseArgs', () => {
  it('defaults to dry run with the import window', () => {
    expect(parseArgs([])).toEqual({ apply: false, protectedWindows: DEFAULT_PROTECTED_WINDOWS })
  })

  it('reads --apply', () => {
    expect(parseArgs(['--apply']).apply).toBe(true)
  })

  it('replaces the default window with one or more --protect-created flags', () => {
    const args = parseArgs([
      '--protect-created=2026-03-01T00:00Z..2026-03-02T00:00Z',
      '--protect-created=2026-04-01..2026-04-02',
    ])
    expect(args.protectedWindows).toEqual([
      { start: new Date('2026-03-01T00:00:00.000Z'), end: new Date('2026-03-02T00:00:00.000Z') },
      { start: new Date('2026-04-01T00:00:00.000Z'), end: new Date('2026-04-02T00:00:00.000Z') },
    ])
  })

  it('rejects a malformed window', () => {
    expect(() => parseArgs(['--protect-created=2026-03-01'])).toThrow()
    expect(() => parseArgs(['--protect-created=nope..2026-03-02'])).toThrow()
    expect(() => parseArgs(['--protect-created=2026-03-02..2026-03-01'])).toThrow()
  })

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['--aply'])).toThrow()
  })
})

describe('countByCreatedDay', () => {
  it('groups by UTC day, most first, ties by day', () => {
    expect(
      countByCreatedDay([
        '2026-03-01T10:00:00Z',
        '2026-03-02T23:30:00Z',
        '2026-03-02T00:10:00Z',
        '2026-02-28T05:00:00Z',
      ]),
    ).toEqual([
      { day: '2026-03-02', count: 2 },
      { day: '2026-02-28', count: 1 },
      { day: '2026-03-01', count: 1 },
    ])
  })

  it('caps the rows at the limit', () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`)
    expect(countByCreatedDay(dates, 15)).toHaveLength(15)
  })
})
