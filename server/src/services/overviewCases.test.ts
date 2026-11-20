import { describe, expect, it } from 'vitest'
import {
  closeCasesOf,
  entryRole,
  recenterPartsOf,
  recenterStoryIds,
  reviewCaseOf,
  type CaseDecision,
  type CaseEntry,
  type RecenterRows,
} from './overviewCases.js'
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
  closingStoryId: null,
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

const join = (i: number, over: Partial<CaseDecision> = {}): CaseDecision => ({
  kind: 'link',
  outcome: 'joined',
  overviewId: 'o1',
  storyId: `s${i}`,
  undone: false,
  inputs: { reportsEndEvent: true, signals: [], linkedAt: day(i).toISOString() },
  ...over,
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

  it('names the end-event story only while closing, and carries the locked-out OUT entries', () => {
    expect(reviewCaseOf(overview({ closingStoryId: 's1' }), []).closingStoryId).toBeNull()
    const closing = reviewCaseOf(overview({ status: 'closing', closingStoryId: 's1', lockedOut: ['cholera in Chad'] }), [])
    expect(closing).toMatchObject({ closingStoryId: 's1', lockedOut: ['cholera in Chad'], title: 'Cholera in Sudan', scope: 'ongoing', frozen: false })
  })
})

describe('closeCasesOf', () => {
  const rows = (over: Partial<Parameters<typeof closeCasesOf>[0]> = {}) => ({
    joins: [join(4)],
    closes: [],
    overviews: [overview()],
    entries: [1, 2, 3, 4, 5].map(i => entry(i)),
    stories: new Map([1, 2, 3, 4, 5].map(i => [`s${i}`, story(i)])),
    ...over,
  })

  it("asks of a live flagged join, with the overview's newest other entries on or before the story's day, at most candidateEntries", () => {
    const [c, ...rest] = closeCasesOf(rows(), { candidateEntries: 2 })
    expect(rest).toEqual([])
    expect(c).toMatchObject({ overviewId: 'o1', charter: CHARTER, story: { id: 's4' } })
    expect(c!.entries).toEqual([
      { title: 'Story 3', date: '2026-10-03' },
      { title: 'Story 2', date: '2026-10-02' },
    ])
  })

  it('leaves out a join undone, not joined, not flagged, or a decision of another kind', () => {
    const joins = [
      join(1, { undone: true }),
      join(2, { outcome: 'alone' }),
      join(3, { inputs: { reportsEndEvent: false, signals: [], linkedAt: null } }),
      join(5, { kind: 'found' }),
    ]
    expect(closeCasesOf(rows({ joins }))).toEqual([])
  })

  it('leaves out a pair judged, but asks again after a failed or stale check, and asks a pair once', () => {
    const close = (i: number, outcome: string): CaseDecision => ({ ...join(i), kind: 'close', outcome })
    const joins = [join(1), join(2), join(2), join(3), join(4)]
    const closes = [close(1, 'not_happened'), close(2, 'failed'), close(3, 'stale'), close(4, 'closing')]
    expect(closeCasesOf(rows({ joins, closes })).map(c => c.story.id)).toEqual(['s2', 's3'])
  })

  it('leaves out an overview not open or quiet, frozen or naming no end event, and a story no longer an active published member', () => {
    for (const o of [overview({ status: 'closing' }), overview({ frozen: true }), overview({ charter: { ...CHARTER, endEvent: null } })])
      expect(closeCasesOf(rows({ overviews: [o] }))).toEqual([])
    expect(closeCasesOf(rows({ overviews: [overview({ status: 'quiet' })] }))).toHaveLength(1)
    expect(closeCasesOf(rows({ entries: [entry(4, { status: 'detached' })] }))).toEqual([])
    expect(closeCasesOf(rows({ entries: [entry(4, { published: false })] }))).toEqual([])
    expect(closeCasesOf(rows({ stories: new Map() }))).toEqual([])
  })

  it('gives the checks oldest story first', () => {
    expect(closeCasesOf(rows({ joins: [join(5), join(2), join(4)] })).map(c => c.story.id)).toEqual(['s2', 's4', 's5'])
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
