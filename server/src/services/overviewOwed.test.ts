import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { owedSlices, owedStanding, type LinkAttempt, type OwedStory } from './overviewOwed.js'

const NOW = new Date('2026-11-20T02:00:00Z')
const DAY_MS = 86_400_000
const daysAgo = (n: number, hour = 2) => new Date(Date.UTC(2026, 10, 20 - n, hour))
const attempt = (outcome: LinkAttempt['outcome'], days: number, over: Partial<LinkAttempt> = {}): LinkAttempt => ({
  outcome,
  undone: false,
  at: daysAgo(days),
  heldFrozen: false,
  ...over,
})

describe('owedStanding', () => {
  it('is new to linking with no attempt, or none since it was last owed afresh', () => {
    expect(owedStanding([], NOW)).toEqual({ kind: 'new' })
    // Two failures, then an Undo of its join owed it afresh: they count no more
    expect(owedStanding([attempt('failed', 9), attempt('failed', 8), attempt('joined', 6, { undone: true })], NOW)).toEqual({ kind: 'new' })
  })

  it('waits on an overview still frozen, and is due again once the freeze lifts', () => {
    expect(owedStanding([attempt('held', 3, { heldFrozen: true })], NOW)).toEqual({ kind: 'frozen' })
    expect(owedStanding([attempt('held', 3)], NOW)).toEqual({ kind: 'retry', lastTry: false })
  })

  it('backs off after each failed or conflicting attempt in a row, counted in UTC days, then gives up', () => {
    // One failure last night: due again a day after it, whatever the hour the run started
    expect(owedStanding([attempt('failed', 0, { at: new Date('2026-11-20T01:00:00Z') })], NOW)).toEqual({ kind: 'backoff' })
    expect(owedStanding([attempt('failed', 1, { at: new Date('2026-11-19T23:00:00Z') })], NOW)).toEqual({ kind: 'retry', lastTry: false })
    // Two in a row: three days after the second
    const two = [attempt('failed', 10), attempt('conflict', 2)]
    expect(owedStanding(two, NOW)).toEqual({ kind: 'backoff' })
    expect(owedStanding(two, new Date(NOW.getTime() + DAY_MS))).toEqual({ kind: 'retry', lastTry: false })
    // Three in a row: seven days after the third, its last try
    const three = [...two.map(a => ({ ...a, at: new Date(a.at.getTime() - 20 * DAY_MS) })), attempt('failed', 7)]
    expect(owedStanding(three, NOW)).toEqual({ kind: 'retry', lastTry: true })
    expect(owedStanding([...three, attempt('conflict', 0)], new Date(NOW.getTime() + 300 * DAY_MS))).toEqual({ kind: 'given_up' })
  })

  it('counts the failures in a row only back to an attempt the model answered (a held one)', () => {
    expect(owedStanding([attempt('failed', 30), attempt('failed', 29), attempt('failed', 28), attempt('held', 20), attempt('failed', 1)], NOW)).toEqual({
      kind: 'retry',
      lastTry: false,
    })
  })
})

describe('owedSlices', () => {
  const story = (id: string, publishedDaysAgo: number, attempts: LinkAttempt[] = []): OwedStory => ({
    id,
    datePublished: new Date(NOW.getTime() - publishedDaysAgo * DAY_MS),
    attempts,
  })
  const options = { ...config.overviews, backfillPerRun: 3, perRun: 2 }

  it('takes the new backlog oldest first, then the retries due in the room left, then the night; waiting and given-up stories take no room', () => {
    const owed = [
      story('night-b', 0.2),
      story('night-a', 0.5),
      story('old-new', 40),
      story('older-new', 50),
      story('retry-old', 100, [attempt('held', 4)]),
      story('retry-older', 120, [attempt('failed', 30), attempt('failed', 20), attempt('failed', 10)]),
      story('frozen', 130, [attempt('held', 9, { heldFrozen: true })]),
      story('backing-off', 140, [attempt('failed', 0)]),
      story('given-up', 150, [attempt('failed', 40), attempt('failed', 35), attempt('failed', 30), attempt('failed', 20)]),
      story('too-old', 200),
    ]
    expect(owedSlices(owed, NOW, options)).toEqual({
      backlog: ['older-new', 'old-new'],
      retries: ['retry-older'],
      night: ['night-a', 'night-b'],
      backlogTotal: 2,
      lastTries: ['retry-older'],
      frozenWaiting: 1,
    })
  })

  it('never lets retries hold the night back or take the new backlog’s room', () => {
    const retries = Array.from({ length: 5 }, (_, i) => story(`r${i}`, 100 + i, [attempt('held', 3)]))
    const got = owedSlices([...retries, story('new', 30), story('night', 0.1)], NOW, options)
    expect(got.backlog).toEqual(['new'])
    expect(got.retries).toHaveLength(2)
    expect(got.night).toEqual(['night'])
  })

  it('holds the night back while new backlog stories remain beyond its slice', () => {
    const backlog = Array.from({ length: 4 }, (_, i) => story(`b${i}`, 10 + i))
    const got = owedSlices([...backlog, story('night', 0.1)], NOW, options)
    expect(got).toMatchObject({ backlog: ['b3', 'b2', 'b1'], retries: [], night: [], backlogTotal: 4 })
  })
})
