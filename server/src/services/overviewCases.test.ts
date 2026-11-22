import { describe, expect, it } from 'vitest'
import { entryRole, recenterPartsOf, recenterStoryIds, reviewCaseOf, type CaseEntry, type RecenterRows } from './overviewCases.js'
import type { Charter, LinkStory } from './overviewTypes.js'

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8))
const CHARTER: Charter = { in: 'The cholera outbreak in Sudan', out: ['cholera elsewhere'], endEvent: 'The outbreak is declared over' }

const overview = (over: Partial<RecenterRows['overview']> = {}): RecenterRows['overview'] => ({
  id: 'o1',
  title: 'Cholera in Sudan',
  charter: CHARTER,
  scope: 'ongoing',
  status: 'open',
  frozen: false,
  lockedOut: [],
  automatedRecenters: 0,
  recenteredAt: null,
  recenteredBy: null,
  recenterUndoneAt: null,
  recenterTriedAt: null,
  ...over,
})

const entry = (i: number, over: Partial<CaseEntry> = {}): CaseEntry => ({
  id: `e${i}`,
  overviewId: 'o1',
  storyId: `s${i}`,
  joinedBy: 'pipeline',
  joinedAt: day(i),
  status: 'active',
  detachedBy: null,
  detachReason: null,
  detachedAt: null,
  locked: false,
  role: 'routine',
  roleKind: null,
  published: true,
  datePublished: day(i),
  title: `Story ${i}`,
  label: `Label ${i}`,
  summary: `Summary ${i}`,
  ...over,
})

const story = (i: number): LinkStory => ({
  id: `s${i}`,
  title: `Story ${i}`,
  label: `Label ${i}`,
  summary: `Summary ${i}`,
  datePublished: day(i),
  date: day(i).toISOString().slice(0, 10),
  issueId: null,
  facts: [],
})

describe('entryRole', () => {
  it('gives a routine entry, or a turning point without a kind, no kind, and holds a kind to the list', () => {
    expect(entryRole({ role: 'routine', roleKind: 'spread' })).toEqual({ role: 'routine', roleKind: null })
    expect(entryRole({ role: 'turning_point', roleKind: null })).toEqual({ role: 'turning_point', roleKind: null })
    expect(entryRole({ role: 'turning_point', roleKind: 'spread' })).toEqual({ role: 'turning_point', roleKind: 'spread' })
    expect(entryRole({ role: 'turning_point', roleKind: 'unheard-of' })).toEqual({ role: 'turning_point', roleKind: 'milestone' })
  })
})

describe('reviewCaseOf', () => {
  it("takes the overview's active entries of published, dated stories, oldest first and a tie by story", () => {
    const entries = [
      entry(3),
      entry(1, { storyId: 's1b' }),
      entry(9, { status: 'detached' }),
      entry(4, { published: false }),
      entry(5, { datePublished: null }),
      entry(6, { overviewId: 'o2' }),
      entry(2, { role: 'turning_point', roleKind: 'spread', locked: true }),
      entry(7, { id: 'e1a', storyId: 's1a', datePublished: day(1) }),
    ]
    const c = reviewCaseOf(overview(), entries)
    expect(c.entries.map(e => e.entryId)).toEqual(['e1a', 'e1', 'e2', 'e3'])
    expect(c.entries[2]).toEqual({
      entryId: 'e2',
      storyId: 's2',
      title: 'Story 2',
      label: 'Label 2',
      summary: 'Summary 2',
      date: '2026-10-02',
      role: { role: 'turning_point', roleKind: 'spread' },
      locked: true,
    })
  })

  it('carries the locked-out OUT entries', () => {
    const c = reviewCaseOf(overview({ lockedOut: ['cholera in Chad'] }), [])
    expect(c).toMatchObject({ lockedOut: ['cholera in Chad'], title: 'Cholera in Sudan', scope: 'ongoing', frozen: false })
  })
})

describe('recenterStoryIds and recenterPartsOf', () => {
  const signal = (i: number, overviewId = 'o1') => ({
    storyId: `s${i}`,
    signals: [{ overviewId, kind: 'wider' as const, quote: `quote ${i}` }],
    linkedAt: day(i),
  })

  it("names the signals' stories and those whose newest row here a review detached", () => {
    const entries = [
      entry(1),
      entry(2, { status: 'detached', detachedBy: 'review', detachedAt: day(3) }),
      // A review's detachment an editor's newer one replaced
      entry(3, { id: 'e3a', status: 'detached', detachedBy: 'review', detachedAt: day(3) }),
      entry(3, { id: 'e3b', status: 'detached', detachedBy: 'editor-1', detachedAt: day(4) }),
      entry(5, { status: 'detached', detachedBy: 'review', detachedAt: day(5), overviewId: 'o2' }),
    ]
    expect(recenterStoryIds('o1', entries, [signal(7), signal(2)])).toEqual(['s7', 's2'])
  })

  it("builds each story's row from its newest detached row here (one never stamped last), locked when any of its rows is", () => {
    const entries = [
      entry(1),
      entry(2, { id: 'old', status: 'detached', detachedBy: 'review', detachedAt: day(3), locked: true }),
      entry(2, { id: 'new', status: 'detached', detachedBy: 'review', detachedAt: day(6) }),
      entry(2, { id: 'unstamped', status: 'detached', detachedBy: 'pipeline', detachedAt: null }),
    ]
    const parts = recenterPartsOf({
      overview: overview(),
      entries,
      founding: ['e1'],
      records: [signal(2), signal(2, 'o2'), signal(8)],
      stories: [story(2), story(8)],
      active: new Set(['s8']),
    })
    expect(parts.rows).toEqual([
      expect.objectContaining({ storyId: 's2', active: false, quotes: ['quote 2'], row: { entryId: 'new', detachedBy: 'review', locked: true } }),
      expect.objectContaining({ storyId: 's8', active: true, quotes: ['quote 8'], row: null }),
    ])
    expect([...parts.entryDates]).toEqual([['e1', day(1)]])
    expect(parts.founding).toEqual(['e1'])
    expect(parts.review.entries.map(e => e.entryId)).toEqual(['e1'])
  })
})
