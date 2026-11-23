import { describe, expect, it } from 'vitest'
import { duplicateErrors, keepOf, mergeDuplicates, mergedGroups, readDuplicateGroups, runAsKeeps, type DuplicateGroup } from './duplicates.js'
import type { AnswerKey } from './keySchema.js'
import type { SavedLinkRun } from './savedLinkReplay.js'

type Entry = AnswerKey['entries'][number]
const entry = (slug: string, date: string, extra: Partial<Entry> = {}): Entry => ({
  slug,
  date,
  title: `Title ${slug}`,
  join: 'must',
  role: 'routine',
  kind: null,
  eitherRole: false,
  roleReview: null,
  values: [],
  statuses: [],
  why: `why ${slug}`,
  ...extra,
})
const near = (slug: string, date: string) => ({ slug, date, title: `Title ${slug}`, why: `near ${slug}` })
const key = (id: string, entries: Entry[], nearMisses: ReturnType<typeof near>[] = []): AnswerKey => ({
  schemaVersion: 1,
  id,
  title: id,
  charter: { in: 'In.', out: [], endEvent: null },
  figures: [],
  entries,
  nearMisses,
  responses: [],
  centers: [],
  notes: '',
})
const group = (keep: string, ...drop: string[]): DuplicateGroup => ({ keep, drop, why: 'one event', confidence: 'high' })

describe('the committed duplicate groups', () => {
  it('parse', () => {
    expect(readDuplicateGroups().errors).toEqual([])
  })
})

describe('duplicateErrors', () => {
  const keys = [key('a', [entry('k', '2026-05-01'), entry('d', '2026-05-02'), entry('late', '2026-06-01')], [near('n', '2026-05-03')])]
  it('passes groups that keep the rules', () => {
    expect(duplicateErrors([group('k', 'd')], keys)).toEqual([])
  })
  it('names a slug in no key, a keep that is a drop and a slug in two groups', () => {
    const errors = duplicateErrors([group('k', 'd', 'k'), group('x', 'd')], keys)
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/k is both the keep and a drop/),
        expect.stringMatching(/x is named by no key/),
        expect.stringMatching(/d is in two groups/),
      ]),
    )
  })
  it('names a drop more than 14 days from its keep', () => {
    expect(duplicateErrors([group('k', 'late')], keys)).toEqual([expect.stringMatching(/late \(2026-06-01\) is more than 14 days/)])
  })
  it('names a keep and its drop on opposite sides of one key', () => {
    expect(duplicateErrors([group('k', 'n')], keys)).toEqual([expect.stringMatching(/in a, the keep k and its drop n are on opposite sides/)])
  })
})

describe('mergeDuplicates', () => {
  const keys = [
    key('own', [entry('k', '2026-05-01', { join: 'optional' }), entry('d', '2026-05-02')]),
    key('stand-in', [entry('x', '2026-04-30'), entry('d', '2026-05-02', { role: 'turning_point', kind: 'decision', join: 'optional', eitherRole: true })]),
    key('near', [entry('y', '2026-05-01')], [near('d', '2026-05-02')]),
    key('untouched', [entry('z', '2026-05-01')]),
  ]
  const [own, standIn, nearKey, untouched] = mergeDuplicates(keys, [group('k', 'd')])

  it("removes a drop where the key holds the keep, and raises the keep's join to the strongest its group had there", () => {
    expect(own!.entries.map(e => [e.slug, e.join])).toEqual([['k', 'must']])
  })
  it("puts the keep in a drop's place with the drop's label and the keep's slug, date and title, no values", () => {
    expect(standIn!.entries[1]).toMatchObject({
      slug: 'k',
      date: '2026-05-01',
      title: 'Title k',
      role: 'turning_point',
      kind: 'decision',
      join: 'optional',
      eitherRole: true,
      values: [],
      why: 'why d',
    })
  })
  it('makes a dropped near miss the keep as a near miss, and leaves other keys alone', () => {
    expect(nearKey!.nearMisses).toEqual([{ slug: 'k', date: '2026-05-01', title: 'Title k', why: 'near d' }])
    expect(untouched).toEqual(keys[3])
  })
  it('keeps the entries in date order', () => {
    const [k] = mergeDuplicates(
      [key('order', [entry('a', '2026-05-01'), entry('d', '2026-05-10')]), key('other', [entry('k', '2026-04-20')])],
      [group('k', 'd')],
    )
    expect(k!.entries.map(e => e.slug)).toEqual(['k', 'a'])
  })
})

describe('mergedGroups', () => {
  it('lists each drop with the keys and roles it had there, only for groups the keys hold', () => {
    const keys = [key('a', [entry('k', '2026-05-01'), entry('d', '2026-05-02')]), key('b', [], [near('d', '2026-05-02')])]
    expect(mergedGroups([group('k', 'd'), group('q', 'r')], keys)).toEqual([
      { keep: 'k', drops: [{ slug: 'd', as: ['a: must routine', 'b: near miss'] }], why: 'one event', confidence: 'high' },
    ])
  })
})

describe('runAsKeeps', () => {
  const run: SavedLinkRun = {
    run: 1,
    overviews: [
      { id: 'o1', title: 'T', charter: { in: 'i', out: [], endEvent: null }, foundedFrom: ['k', 'd'], foundedOn: '2026-05-02', members: ['k', 'd', 'x'] },
      { id: 'o2', title: 'U', charter: { in: 'i', out: [], endEvent: null }, foundedFrom: ['e', 'y'], foundedOn: '2026-05-03', members: ['e', 'y'] },
    ],
    roles: [
      ['d', { role: 'turning_point', roleKind: 'decision' }],
      ['e', { role: 'routine', roleKind: null }],
    ],
    traces: [],
    signals: [{ slug: 'e', overviewId: 'o1', kind: 'wider' }],
    stopped: false,
  }
  const read = runAsKeeps(run, keepOf([group('k', 'd'), group('j', 'e')]))
  it('reads a drop as its keep: a member and its keep in one overview once, a founding pair holding it as the keep', () => {
    expect(read.overviews[0]).toMatchObject({ foundedFrom: ['k', 'k'], members: ['k', 'x'] })
    expect(read.overviews[1]).toMatchObject({ foundedFrom: ['j', 'y'], members: ['j', 'y'] })
  })
  it("takes a drop's role only for a keep with none of its own, and renames its signals", () => {
    expect(new Map(read.roles).get('k')).toEqual({ role: 'turning_point', roleKind: 'decision' })
    expect(new Map(read.roles).get('j')).toEqual({ role: 'routine', roleKind: null })
    expect(read.signals).toEqual([{ slug: 'j', overviewId: 'o1', kind: 'wider' }])
  })
  it('changes nothing when no group applies', () => {
    expect(runAsKeeps(run, keepOf([]))).toEqual(run)
  })
})
