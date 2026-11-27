import { describe, it, expect } from 'vitest'
import { DanglingReference, ReferenceGuard, type ForeignKey } from './references.js'

const fk = (table: string, column: string, target: string, nullable: boolean): ForeignKey => ({ table, column, target, targetColumn: 'id', nullable })

/** Load order: a table's references to an earlier table are checked as its rows come, to itself or a later one at the end. */
const ORDER = ['issues', 'stories', 'clusters', 'runs', 'facts']
const KEYS = [
  fk('issues', 'parent_id', 'issues', true),
  fk('stories', 'issue_id', 'issues', true),
  fk('stories', 'cluster_id', 'clusters', true),
  fk('clusters', 'primary_id', 'stories', true),
  fk('runs', 'story_id', 'stories', true),
  fk('facts', 'run_id', 'runs', false),
]

describe('the reference guard', () => {
  it('passes rows whose references all point at rows already in the copy, or are null', () => {
    const guard = new ReferenceGuard(KEYS, ORDER)
    expect(guard.admit('issues', { id: 'i1', parent_id: null })).toEqual({ id: 'i1', parent_id: null })
    expect(guard.admit('stories', { id: 's1', issue_id: 'i1', cluster_id: null })).toEqual({ id: 's1', issue_id: 'i1', cluster_id: null })
    expect(guard.admit('runs', { id: 'r1', story_id: 's1' })).toEqual({ id: 'r1', story_id: 's1' })
    expect(guard.admit('facts', { id: 'f1', run_id: 'r1' })).toEqual({ id: 'f1', run_id: 'r1' })
    expect(() => guard.finish()).not.toThrow()
    expect(guard.nulled).toEqual(new Map())
  })

  it('writes a reference to a row outside the copy as null where the column allows it, and counts it', () => {
    const guard = new ReferenceGuard(KEYS, ORDER)
    guard.admit('issues', { id: 'i1', parent_id: null })
    expect(guard.admit('stories', { id: 's1', issue_id: 'i9', cluster_id: null })).toEqual({ id: 's1', issue_id: null, cluster_id: null })
    expect(guard.admit('runs', { id: 'r1', story_id: 's9' })).toEqual({ id: 'r1', story_id: null })
    expect(guard.admit('runs', { id: 'r2', story_id: 's8' })).toEqual({ id: 'r2', story_id: null })
    expect(guard.nulled).toEqual(
      new Map([
        ['stories.issue_id', 1],
        ['runs.story_id', 2],
      ]),
    )
  })

  it('refuses a row whose required reference points outside the copy', () => {
    const guard = new ReferenceGuard(KEYS, ORDER)
    expect(() => guard.admit('facts', { id: 'f1', run_id: 'r9' })).toThrow(DanglingReference)
    expect(() => guard.admit('facts', { id: 'f1', run_id: 'r9' })).toThrow(/facts\.run_id/)
  })

  it('checks references to the same or a later table once every row is in, and refuses one left pointing outside', () => {
    const good = new ReferenceGuard(KEYS, ORDER)
    good.admit('issues', { id: 'i2', parent_id: 'i1' })
    good.admit('issues', { id: 'i1', parent_id: null })
    good.admit('stories', { id: 's1', issue_id: 'i1', cluster_id: 'c1' })
    good.admit('clusters', { id: 'c1', primary_id: 's1' })
    expect(() => good.finish()).not.toThrow()

    const bad = new ReferenceGuard(KEYS, ORDER)
    bad.admit('issues', { id: 'i1', parent_id: null })
    bad.admit('stories', { id: 's1', issue_id: 'i1', cluster_id: 'c9' })
    bad.admit('clusters', { id: 'c1', primary_id: 's1' })
    expect(() => bad.finish()).toThrow(DanglingReference)
    expect(() => bad.finish()).toThrow(/stories\.cluster_id/)
  })

  it('treats a reference to a table the copy does not hold as pointing outside it', () => {
    const guard = new ReferenceGuard([fk('stories', 'feed_id', 'feeds', true), fk('runs', 'feed_id', 'feeds', false)], ['stories', 'runs'])
    expect(guard.admit('stories', { id: 's1', feed_id: 'f1' })).toEqual({ id: 's1', feed_id: null })
    expect(() => guard.admit('runs', { id: 'r1', feed_id: 'f1' })).toThrow(/runs\.feed_id/)
  })
})
