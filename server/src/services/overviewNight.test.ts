import { describe, expect, it, vi } from 'vitest'
import type { LinkDeps } from './overviewLink.js'
import { runNight, upkeepClock, type NightDeps } from './overviewNight.js'
import type { OwedSlices } from './overviewOwed.js'
import type { LinkStory } from './overviewTypes.js'
import type { UpkeepDeps } from './overviewUpkeep.js'

const NOW = new Date('2026-11-18T03:00:00Z')
const story = (id: string, day: number): LinkStory => ({
  id,
  title: `Title ${id}`,
  label: 'Label',
  summary: 'Summary.',
  datePublished: new Date(Date.UTC(2026, 5, day)),
  date: `2026-06-${String(day).padStart(2, '0')}`,
  issueId: null,
  facts: [],
})
const STORIES = new Map(['b1', 'b2', 'r1', 'n1'].map((id, i) => [id, story(id, i + 1)]))
const slices = (over: Partial<OwedSlices> = {}): OwedSlices => ({
  backlog: ['b1', 'b2'],
  retries: ['r1'],
  night: ['n1'],
  backlogTotal: 2,
  lastTries: ['r1'],
  frozenWaiting: 0,
  ...over,
})

function deps(owed: OwedSlices) {
  const clocks: Date[] = []
  const link: LinkDeps = {
    // A read that throws fails the story's link: the retry on its last try is given up
    neighbours: async s => {
      if (s.id === 'r1') throw new Error('boom')
      return []
    },
    memberships: async () => ({ active: new Map(), lockedOut: new Map() }),
    overviews: async () => [],
    stories: async () => [],
    link: vi.fn(),
    found: vi.fn(),
    foundCheck: vi.fn(),
  }
  const upkeep = {
    states: async () => [],
    reviewCase: async () => null,
    auditPicks: async () => [],
    standsCases: async () => [],
    recenterCases: async (at: { clock: Date }) => {
      clocks.push(at.clock)
      return []
    },
  } as unknown as UpkeepDeps
  const night: NightDeps = {
    owed: async () => owed,
    stories: async ids => ids.flatMap(id => (STORIES.has(id) ? [STORIES.get(id)!] : [])),
    link,
    apply: async result => ({ kind: 'written', outcome: result.outcome }),
    upkeep,
  }
  return { night, clocks }
}

describe('runNight', () => {
  it('links the backlog, the retries due and the night in that order, then runs the upkeep at the development clock', async () => {
    const { night, clocks } = deps(slices())
    const got = await runNight(night, { now: NOW, today: '2026-11-18' }, { concurrency: 2, keepGoing: async () => true })
    expect(got.stories.map(s => s.id)).toEqual(['b1', 'b2', 'r1', 'n1'])
    expect([...got.run.outcomes]).toEqual([
      ['b1', 'none'],
      ['b2', 'none'],
      ['r1', 'failed'],
      ['n1', 'none'],
    ])
    expect(got.givenUp).toEqual(['r1'])
    // The backlog is all taken: the upkeep counts in now
    expect(clocks).toEqual([NOW])
    expect(got.upkeep).not.toBeNull()
  })

  it('gives up only a last try whose failure was stored: one whose write stored nothing is owed as before', async () => {
    const { night } = deps(slices())
    const got = await runNight(
      { ...night, apply: async result => (result.story.id === 'r1' ? { kind: 'unwritten' } : { kind: 'written', outcome: result.outcome }) },
      { now: NOW, today: '2026-11-18' },
      { concurrency: 2, keepGoing: async () => true },
    )
    expect(got.run.unwritten).toEqual(['r1'])
    expect(got.givenUp).toEqual([])
  })

  it('counts in the newest linked story’s time while the backfill drains, and runs no upkeep once the step stopped', async () => {
    const draining = deps(slices({ backlogTotal: 900, night: [] }))
    const got = await runNight(draining.night, { now: NOW, today: '2026-11-18' }, { concurrency: 1, keepGoing: async () => true })
    expect(got.clock).toEqual(STORIES.get('r1')!.datePublished)

    let calls = 0
    const stopped = deps(slices())
    // Going for the four writes, then switched off before the upkeep
    const late = await runNight(stopped.night, { now: NOW, today: '2026-11-18' }, { concurrency: 1, keepGoing: async () => ++calls <= 8 })
    expect(late.run.outcomes.size).toBe(4)
    expect(late.upkeep).toBeNull()
    expect(stopped.clocks).toEqual([])
  })
})

describe('upkeepClock', () => {
  it('counts in the newest linked story’s time while a backfill drains, and in now once it is done', () => {
    const linked = [story('a', 1), story('b', 20)]
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 900 }, linked, NOW)).toEqual(story('b', 20).datePublished)
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 2 }, linked, NOW)).toEqual(NOW)
    expect(upkeepClock({ backlog: ['a', 'b'], backlogTotal: 900 }, [], NOW)).toEqual(NOW)
  })
})
