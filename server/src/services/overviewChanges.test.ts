import { describe, expect, it } from 'vitest'
import {
  applied,
  changesFrom,
  entryChange,
  inverted,
  merged,
  newOverviewRow,
  notHolding,
  overviewChange,
  plan,
  draft,
  removesLink,
  settle,
  type EntryRow,
  type Rows,
} from './overviewChanges.js'

const day = (d: number) => new Date(Date.UTC(2026, 5, d))
const base = newOverviewRow({
  id: 'o1',
  title: 'Ebola in Ituri',
  issueId: null,
  charter: { in: 'The Ebola outbreak in Ituri.', out: [], endEvent: 'Declared over' },
  charterModel: 'm',
  charterPromptVersion: 'v',
  foundedAt: day(1),
})
const entry = (id: string, d: number, over: Partial<EntryRow> = {}): EntryRow => ({
  id,
  overviewId: 'o1',
  storyId: `s-${id}`,
  joinedBy: 'pipeline',
  joinedAt: day(d),
  published: true,
  datePublished: day(d),
  status: 'active',
  detachedBy: null,
  detachReason: null,
  detachedAt: null,
  locked: false,
  role: 'routine',
  roleKind: null,
  ...over,
})
const rows = (over: Partial<Rows['overview']> = {}, entries = [entry('e1', 1), entry('e2', 2), entry('e3', 3)]): Rows => ({
  overview: { ...base, scope: 'ongoing', lastEntryAt: day(3), ...over },
  entries,
})
const decision = draft({ id: 'd1', kind: 'status', outcome: 'detached', overviewId: 'o1', storyId: null, actor: 'pipeline', inputs: {} })
const detach = (r: Rows, id: string) =>
  entryChange(
    r.entries.find(e => e.id === id)!,
    { status: 'detached', detachedBy: 'pipeline', detachReason: 'unpublished', detachedAt: day(9) },
  )

describe('the write model', () => {
  it('settles the last entry and the scope after the changes: the newest active published entry, and single at one', () => {
    const r = rows()
    const p = settle(r, plan(decision, { changes: detach(r, 'e3') }))
    expect(applied(r, p).overview).toMatchObject({ lastEntryAt: day(2), scope: 'ongoing' })
    // Idempotent: settling again moves nothing more
    expect(settle(r, p)).toEqual(p)
    const two = settle(r, plan(decision, { changes: [...detach(r, 'e3'), ...detach(r, 'e2')] }))
    expect(applied(r, two).overview).toMatchObject({ lastEntryAt: day(1), scope: 'single' })
    // An unpublished entry counts toward neither
    const hidden = rows({}, [entry('e1', 1), entry('e2', 2, { published: false })])
    expect(applied(hidden, settle(hidden, plan(decision))).overview).toMatchObject({ lastEntryAt: day(1), scope: 'single' })
  })

  it('moves nothing for a decision about no overview row, and refuses to apply one', () => {
    const alone = plan({ ...decision, kind: 'link', outcome: 'none', overviewId: null })
    expect(settle(null, alone)).toBe(alone)
    expect(() => applied(null, alone)).toThrow('A plan on no overview creates none')
  })

  it('knows a write that takes a public link away: hidden, off ongoing, or an entry detached', () => {
    const r = rows()
    expect(removesLink(true, detach(r, 'e1'))).toBe(true)
    expect(removesLink(true, overviewChange(r.overview, { hidden: true }))).toBe(true)
    expect(removesLink(true, overviewChange(r.overview, { scope: 'forming' }))).toBe(true)
    expect(removesLink(true, overviewChange(r.overview, { title: 'Ebola' }))).toBe(false)
    expect(removesLink(false, detach(r, 'e1'))).toBe(false)
  })

  it('merges the changes of one row: the first before, the last after', () => {
    const r = rows()
    const first = overviewChange(r.overview, { status: 'quiet' })
    const second = overviewChange({ ...r.overview, status: 'quiet' }, { status: 'open', frozen: true })
    expect(merged([...first, ...second])).toEqual([
      { table: 'overview', id: 'o1', before: { status: 'open', frozen: false }, after: { status: 'open', frozen: true } },
    ])
  })
})

describe("undo's side", () => {
  it('inverts last first, without the one-way fields, and drops a change left empty', () => {
    const r = rows()
    const changes = [
      ...overviewChange(r.overview, { status: 'quiet', slug: 'ebola' }),
      ...overviewChange({ ...r.overview, status: 'quiet' }, { lastEntryAt: day(9), scope: 'forming' }),
      ...detach(r, 'e1'),
    ]
    expect(inverted(changes)).toEqual([
      { table: 'entry', id: 'e1', before: changes[2]!.after, after: changes[2]!.before },
      { table: 'overview', id: 'o1', before: { status: 'quiet' }, after: { status: 'open' } },
    ])
  })

  it('reads a stored change set back with its dates revived', () => {
    const r = rows()
    const stored = JSON.parse(JSON.stringify(detach(r, 'e1')))
    expect(changesFrom(stored)).toEqual(detach(r, 'e1'))
  })

  it('names the first field that no longer holds, or a row gone; null when every change holds', () => {
    const r = rows()
    const changes = [...overviewChange(r.overview, { status: 'quiet' }), ...detach(r, 'e1')]
    const after = applied(r, plan(decision, { changes }))
    const back = inverted(changes)
    expect(notHolding(back, after)).toBeNull()
    const moved = { ...after, overview: { ...after.overview, status: 'closed' as const } }
    expect(notHolding(back, moved)).toMatchObject({ field: 'status', change: { table: 'overview' } })
    expect(notHolding(back, { ...after, entries: after.entries.filter(e => e.id !== 'e1') })).toMatchObject({ field: 'row' })
    // A charter compares as JSON, whatever its key order
    const charter = overviewChange(r.overview, { charter: { ...r.overview.charter, out: ['Ebola in Uganda'] } })
    const reordered = { ...r, overview: { ...r.overview, charter: { endEvent: 'Declared over', out: [], in: 'The Ebola outbreak in Ituri.' } } }
    expect(notHolding(charter, reordered)).toBeNull()
  })
})
