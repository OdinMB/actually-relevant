import { describe, expect, it } from 'vitest'
import { anomalies, nextState, reviewDue, scopeAfterReview } from './overviewStatus.js'
import type { OverviewState } from './overviewTypes.js'

const DAY = 86_400_000
const CLOCK = new Date('2026-09-01T12:00:00Z')
const daysAgo = (days: number) => new Date(CLOCK.getTime() - days * DAY)
const OPTIONS = { quietAfterDays: 21, fadeAfterDays: 120, burstLimit: 5, reviewAt: [3, 6, 12, 25, 50], reviewEveryDays: 30, reportReviewEveryDays: 7 }

const state = (over: Partial<OverviewState> = {}): OverviewState => ({
  id: 'o',
  scope: 'ongoing',
  status: 'open',
  closedReason: null,
  frozen: false,
  hidden: false,
  lastEntryAt: daysAgo(1),
  activeEntries: 4,
  unpublished: [],
  entriesAtLastReview: 4,
  reviewedAt: daysAgo(2),
  burstJoins: 0,
  burstAt: null,
  reopenedAt: null,
  reportAt: null,
  recenteredAt: null,
  recenteredBy: null,
  ...over,
})

const statusOf = (s: OverviewState, clock = CLOCK) => nextState(s, clock, OPTIONS).filter(m => m.kind === 'status')

describe('nextState', () => {
  it('goes quiet after 21 days without a new entry, and opens again on one', () => {
    expect(statusOf(state({ lastEntryAt: daysAgo(20) }))).toEqual([])
    expect(statusOf(state({ lastEntryAt: daysAgo(21) }))).toEqual([{ kind: 'status', from: 'open', to: 'quiet', reason: 'quiet' }])
    expect(statusOf(state({ status: 'quiet', lastEntryAt: daysAgo(30) }))).toEqual([])
    expect(statusOf(state({ status: 'quiet', lastEntryAt: daysAgo(2) }))).toEqual([{ kind: 'status', from: 'quiet', to: 'open', reason: 'active' }])
  })

  it('closes as faded after 120 days quiet, and a faded overview with a new entry opens again', () => {
    expect(statusOf(state({ status: 'quiet', lastEntryAt: daysAgo(120) }))).toEqual([{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }])
    expect(statusOf(state({ status: 'closed', closedReason: 'faded', lastEntryAt: daysAgo(3) }))).toEqual([
      { kind: 'status', from: 'closed', to: 'open', reason: 'active' },
    ])
    // An editor's closure never reopens on its own
    expect(statusOf(state({ status: 'closed', closedReason: 'editor', lastEntryAt: daysAgo(3) }))).toEqual([])
  })

  it('counts quiet and fading from a person’s reopen when it is later than the last entry', () => {
    const reopened = state({ lastEntryAt: daysAgo(200), reopenedAt: daysAgo(1) })
    expect(statusOf(reopened)).toEqual([])
    expect(statusOf({ ...reopened, reopenedAt: daysAgo(21) })).toEqual([{ kind: 'status', from: 'open', to: 'quiet', reason: 'quiet' }])
    expect(statusOf({ ...reopened, status: 'quiet', reopenedAt: daysAgo(120) })).toEqual([{ kind: 'status', from: 'quiet', to: 'closed', reason: 'faded' }])
    // An entry newer than the reopen counts from the entry
    expect(statusOf(state({ lastEntryAt: daysAgo(2), reopenedAt: daysAgo(30) }))).toEqual([])
  })

  it('counts in development time: the clock is the day linking has reached', () => {
    const backfilled = state({ lastEntryAt: new Date('2026-04-30T12:00:00Z') })
    expect(statusOf(backfilled, new Date('2026-05-10T12:00:00Z'))).toEqual([])
    expect(statusOf(backfilled)).toEqual([{ kind: 'status', from: 'open', to: 'closed', reason: 'faded' }])
  })

  it('detaches unpublished members and recomputes the scope, frozen or not; frozen skips the rest', () => {
    const frozen = state({ frozen: true, activeEntries: 1, unpublished: [{ entryId: 'e1', storyId: 's1' }], lastEntryAt: daysAgo(200) })
    expect(nextState(frozen, CLOCK, OPTIONS)).toEqual([
      { kind: 'detach', entryId: 'e1', storyId: 's1' },
      { kind: 'scope', from: 'ongoing', to: 'single' },
    ])
  })

  it('leaves an ongoing overview below 3 public until its review, makes one left with one entry single, and a single one grown to two forming', () => {
    expect(nextState(state({ activeEntries: 2 }), CLOCK, OPTIONS)).toEqual([])
    expect(nextState(state({ activeEntries: 0 }), CLOCK, OPTIONS)).toEqual([{ kind: 'scope', from: 'ongoing', to: 'single' }])
    expect(nextState(state({ scope: 'single', activeEntries: 2 }), CLOCK, OPTIONS)).toEqual([{ kind: 'scope', from: 'single', to: 'forming' }])
  })
})

describe('scopeAfterReview', () => {
  it('makes an overview public only when its review keeps at least 3', () => {
    expect([0, 1, 2, 3, 7].map(scopeAfterReview)).toEqual(['single', 'single', 'forming', 'ongoing', 'ongoing'])
  })
})

describe('anomalies', () => {
  it('finds a burst past the limit, never on a frozen overview', () => {
    expect(anomalies(state({ burstJoins: 5 }), OPTIONS)).toEqual([])
    expect(anomalies(state({ burstJoins: 6 }), OPTIONS)).toEqual(['burst'])
    expect(anomalies(state({ burstJoins: 6, frozen: true }), OPTIONS)).toEqual([])
  })
})

describe('reviewDue', () => {
  const at = { now: CLOCK }
  const due = (over: Partial<OverviewState>) => reviewDue(state(over), at, OPTIONS)

  it('is due at 3, 6, 12, 25 and 50 entries, again when a forming overview cut back climbs to 3', () => {
    expect(due({ scope: 'forming', activeEntries: 2, entriesAtLastReview: 0 })).toBeNull()
    expect(due({ scope: 'forming', activeEntries: 3, entriesAtLastReview: 0 })).toBe('entries')
    expect(due({ scope: 'forming', activeEntries: 3, entriesAtLastReview: 2 })).toBe('entries')
    expect(due({ activeEntries: 5, entriesAtLastReview: 3 })).toBeNull()
    expect(due({ activeEntries: 7, entriesAtLastReview: 3 })).toBe('entries')
    expect(due({ activeEntries: 50, entriesAtLastReview: 49 })).toBe('entries')
  })

  it('is due every 30 days while public and not closed', () => {
    expect(due({ reviewedAt: daysAgo(29) })).toBeNull()
    expect(due({ reviewedAt: daysAgo(30) })).toBe('periodic')
    expect(due({ reviewedAt: daysAgo(30), status: 'closed', closedReason: 'faded' })).toBeNull()
    expect(due({ reviewedAt: daysAgo(30), scope: 'forming' })).toBeNull()
  })

  it('is due on a reader’s report that queued one, until a review runs after it; never while frozen or single', () => {
    expect(due({ reportAt: daysAgo(1) })).toBe('report')
    expect(due({ reportAt: daysAgo(3) })).toBeNull()
    expect(due({ reportAt: daysAgo(1), reviewedAt: null, entriesAtLastReview: 0, activeEntries: 2, scope: 'forming' })).toBe('report')
    expect(due({ reportAt: daysAgo(1), status: 'closed', closedReason: 'faded' })).toBe('report')
    expect(due({ reportAt: daysAgo(1), frozen: true })).toBeNull()
    expect(due({ reportAt: daysAgo(1), scope: 'single', activeEntries: 1 })).toBeNull()
  })

  it("is due after an editor's re-center until a review runs after it, after a report and before the entry counts", () => {
    const recentered = { recenteredBy: 'editor', recenteredAt: daysAgo(1) }
    expect(due(recentered)).toBe('recenter')
    expect(due({ ...recentered, recenteredAt: daysAgo(3) })).toBeNull()
    expect(due({ ...recentered, reviewedAt: null, entriesAtLastReview: 0, activeEntries: 2, scope: 'forming' })).toBe('recenter')
    expect(due({ ...recentered, activeEntries: 7, entriesAtLastReview: 3 })).toBe('recenter')
    expect(due({ ...recentered, reportAt: daysAgo(1) })).toBe('report')
    // A frozen overview gets it once unfrozen; a single one never; automation's queues none
    expect(due({ ...recentered, frozen: true })).toBeNull()
    expect(due({ ...recentered, scope: 'single', activeEntries: 1 })).toBeNull()
    expect(due({ ...recentered, recenteredBy: 'recenter' })).toBeNull()
  })

  it('is due on a burst, the only review a frozen overview gets; a single overview never', () => {
    expect(due({ frozen: true, burstAt: daysAgo(0), activeEntries: 7, entriesAtLastReview: 3 })).toBe('burst')
    expect(due({ frozen: true, activeEntries: 7, entriesAtLastReview: 3 })).toBeNull()
    expect(due({ scope: 'single', activeEntries: 1, entriesAtLastReview: 0, burstAt: daysAgo(0) })).toBeNull()
  })
})
