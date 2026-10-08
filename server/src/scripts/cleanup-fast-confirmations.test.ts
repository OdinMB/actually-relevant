import { describe, it, expect } from 'vitest'
import {
  parseArgs,
  applyGuardError,
  gapSeconds,
  bucketGaps,
  selectFastConfirmations,
  planUnsubscribes,
  DEFAULT_CUTOFF,
} from './cleanup-fast-confirmations.js'

const cutoff = new Date('2026-06-03T00:00:00.000Z')

function row(email: string, createdAt: string, gapSec: number | null) {
  const created = new Date(createdAt)
  return {
    email,
    createdAt: created,
    confirmedAt: gapSec === null ? null : new Date(created.getTime() + gapSec * 1000),
  }
}

describe('parseArgs', () => {
  it('defaults to preview, no threshold and the 2026-06-03 cutoff', () => {
    const args = parseArgs([])
    expect(args.apply).toBe(false)
    expect(args.maxSeconds).toBeNull()
    expect(args.cutoff.toISOString()).toBe(DEFAULT_CUTOFF.toISOString())
    expect(DEFAULT_CUTOFF.toISOString()).toBe('2026-06-03T00:00:00.000Z')
  })

  it('reads --apply, --max-seconds and --before', () => {
    const args = parseArgs(['--apply', '--max-seconds=10', '--before=2026-05-01'])
    expect(args.apply).toBe(true)
    expect(args.maxSeconds).toBe(10)
    expect(args.cutoff.toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })

  it('rejects a non-positive or non-numeric --max-seconds', () => {
    expect(() => parseArgs(['--max-seconds=0'])).toThrow()
    expect(() => parseArgs(['--max-seconds=-5'])).toThrow()
    expect(() => parseArgs(['--max-seconds=abc'])).toThrow()
    expect(() => parseArgs(['--max-seconds='])).toThrow()
  })

  it('rejects an unparseable --before', () => {
    expect(() => parseArgs(['--before=soon'])).toThrow()
  })

  it('rejects unknown flags so a typo cannot silently fall back to defaults', () => {
    expect(() => parseArgs(['--max-second=10'])).toThrow()
  })
})

describe('applyGuardError', () => {
  it('refuses apply without --max-seconds', () => {
    expect(applyGuardError({ apply: true, maxSeconds: null, cutoff })).toMatch(/--max-seconds/)
  })

  it('allows apply with --max-seconds', () => {
    expect(applyGuardError({ apply: true, maxSeconds: 10, cutoff })).toBeNull()
  })

  it('allows preview without --max-seconds', () => {
    expect(applyGuardError({ apply: false, maxSeconds: null, cutoff })).toBeNull()
  })
})

describe('gapSeconds', () => {
  it('returns the confirm gap in seconds, never negative', () => {
    expect(gapSeconds(row('a@x.com', '2026-05-01T00:00:00Z', 7.5))).toBe(7.5)
    const r = { email: 'a@x.com', createdAt: new Date('2026-05-01T00:00:10Z'), confirmedAt: new Date('2026-05-01T00:00:00Z') }
    expect(gapSeconds(r)).toBe(0)
  })
})

describe('bucketGaps', () => {
  it('counts every pre-cutoff confirmation into its gap bucket', () => {
    const rows = [
      row('a@x.com', '2026-05-01T00:00:00Z', 1),
      row('b@x.com', '2026-05-01T00:00:00Z', 4.99),
      row('c@x.com', '2026-05-01T00:00:00Z', 5),
      row('d@x.com', '2026-05-01T00:00:00Z', 20),
      row('e@x.com', '2026-05-01T00:00:00Z', 45),
      row('f@x.com', '2026-05-01T00:00:00Z', 120),
      row('g@x.com', '2026-05-01T00:00:00Z', 600),
      row('h@x.com', '2026-05-01T00:00:00Z', 7200),
      row('late@x.com', '2026-07-01T00:00:00Z', 1), // after cutoff: excluded
      row('unconf@x.com', '2026-05-01T00:00:00Z', null), // never confirmed: excluded
    ]
    const buckets = bucketGaps(rows, cutoff)
    expect(buckets.map((b) => [b.label, b.count])).toEqual([
      ['<5s', 2],
      ['5-10s', 1],
      ['10-30s', 1],
      ['30-60s', 1],
      ['1-5min', 1],
      ['5-60min', 1],
      ['>1h', 1],
    ])
  })
})

describe('selectFastConfirmations', () => {
  it('selects pre-cutoff confirmations faster than the threshold', () => {
    const rows = [
      row('fast@x.com', '2026-05-01T00:00:00Z', 3),
      row('slow@x.com', '2026-05-01T00:00:00Z', 300),
      row('edge@x.com', '2026-05-01T00:00:00Z', 10), // not below 10
    ]
    const { candidates, reconfirmed } = selectFastConfirmations(rows, cutoff, 10)
    expect(candidates.map((c) => c.email)).toEqual(['fast@x.com'])
    expect(candidates[0].gapSeconds).toBe(3)
    expect(reconfirmed).toEqual([])
  })

  it('ignores signups created on or after the cutoff and unconfirmed rows', () => {
    const rows = [
      row('new@x.com', '2026-06-03T00:00:00Z', 1),
      row('unconf@x.com', '2026-05-01T00:00:00Z', null),
    ]
    expect(selectFastConfirmations(rows, cutoff, 10).candidates).toEqual([])
  })

  it('dedupes by lowercased email', () => {
    const rows = [
      row('Fast@X.com', '2026-05-01T00:00:00Z', 4),
      row('fast@x.com', '2026-05-02T00:00:00Z', 2),
    ]
    const { candidates } = selectFastConfirmations(rows, cutoff, 10)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].email).toBe('fast@x.com')
    expect(candidates[0].gapSeconds).toBe(2)
  })

  it('protects an address that confirmed again after the cutoff', () => {
    const rows = [
      row('back@x.com', '2026-05-01T00:00:00Z', 2),
      row('BACK@x.com', '2026-07-01T00:00:00Z', 90),
    ]
    const { candidates, reconfirmed } = selectFastConfirmations(rows, cutoff, 10)
    expect(candidates).toEqual([])
    expect(reconfirmed).toEqual(['back@x.com'])
  })

  it('protects an address that also has a slow (human-paced) pre-cutoff confirmation', () => {
    const rows = [
      row('mixed@x.com', '2026-05-01T00:00:00Z', 2),
      row('mixed@x.com', '2026-05-10T00:00:00Z', 120),
    ]
    expect(selectFastConfirmations(rows, cutoff, 10).candidates).toEqual([])
  })

  it('does not treat a later unconfirmed signup as a re-confirmation', () => {
    const rows = [
      row('bot@x.com', '2026-05-01T00:00:00Z', 2),
      row('bot@x.com', '2026-07-01T00:00:00Z', null),
    ]
    const { candidates, reconfirmed } = selectFastConfirmations(rows, cutoff, 10)
    expect(candidates.map((c) => c.email)).toEqual(['bot@x.com'])
    expect(reconfirmed).toEqual([])
  })
})

describe('planUnsubscribes', () => {
  it('unsubscribes only candidates whose Plunk contact is still subscribed', () => {
    const candidates = [
      { email: 'sub@x.com', gapSeconds: 1 },
      { email: 'gone@x.com', gapSeconds: 1 },
      { email: 'already@x.com', gapSeconds: 1 },
    ]
    const contacts = [
      { id: 'c1', email: 'SUB@x.com', subscribed: true },
      { id: 'c2', email: 'already@x.com', subscribed: false },
    ]
    const plan = planUnsubscribes(candidates, contacts)
    expect(plan.toUnsubscribe).toEqual([{ id: 'c1', plunkEmail: 'SUB@x.com', email: 'sub@x.com', gapSeconds: 1 }])
    expect(plan.notSubscribed.sort()).toEqual(['already@x.com', 'gone@x.com'])
  })
})
