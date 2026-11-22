import { describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../lib/logger.js', () => ({ createLogger: () => mockLogger }))

const { caseEntryFrom, lockedOutOf, OVERVIEW_COLUMNS, OVERVIEW_SELECT, overviewRowFrom, readableOverviews } = await import('./overviewRow.js')
type RawOverview = import('./overviewRow.js').RawOverview

const raw = (over: Partial<RawOverview> = {}): RawOverview => ({
  id: 'o1',
  issueId: null,
  foundedAt: new Date('2026-10-01T08:00:00Z'),
  title: 'Cholera in Sudan',
  slug: null,
  scope: 'ongoing',
  status: 'quiet',
  closedAt: null,
  closedReason: null,
  frozen: false,
  frozenBy: null,
  frozenAt: null,
  hidden: false,
  charter: { in: 'The cholera outbreak in Sudan', out: [], endEvent: null },
  charterModel: 'model',
  charterPromptVersion: 'v1',
  recenteredAt: null,
  recenteredBy: null,
  recenterUndoneAt: null,
  recenterTriedAt: null,
  automatedRecenters: 0,
  entriesAtLastReview: 0,
  reviewedAt: null,
  reopenedAt: null,
  joinsCountedFrom: null,
  lockedOut: ['cholera in Chad', 7, null],
  lastEntryAt: null,
  ...over,
})

describe('the overviews row', () => {
  it('parses the charter and lockedOut and holds the enums to their values', () => {
    expect(overviewRowFrom(raw())).toMatchObject({ scope: 'ongoing', status: 'quiet', lockedOut: ['cholera in Chad'], charter: { endEvent: null } })
    expect(overviewRowFrom(raw({ scope: 'wide', status: 'gone' }))).toMatchObject({ scope: 'single', status: 'open' })
  })

  it('gives no row for a charter that does not parse', () => {
    expect(overviewRowFrom(raw({ charter: { in: 'x' } }))).toBeNull()
  })

  it('leaves out of a read the rows whose charter does not parse, and logs each by its id', () => {
    const rows = readableOverviews([raw(), raw({ id: 'o2', charter: { in: 'x' } })], 'the upkeep')
    expect(rows.map(r => r.id)).toEqual(['o1'])
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith({ overviewId: 'o2', read: 'the upkeep' }, expect.stringMatching(/charter/))
  })

  it('reads lockedOut as a list of strings, whatever the column holds', () => {
    expect(lockedOutOf(null)).toEqual([])
    expect(lockedOutOf({ out: 'x' })).toEqual([])
    expect(lockedOutOf(['a', 2, 'b'])).toEqual(['a', 'b'])
  })

  it('reads every field of the row, in SQL and through Prisma alike', () => {
    const fields = Object.keys(raw())
    expect(Object.keys(OVERVIEW_SELECT).sort()).toEqual([...fields].sort())
    for (const f of fields) expect(OVERVIEW_COLUMNS.sql).toContain(` AS "${f}"`)
  })
})

describe('caseEntryFrom', () => {
  it('holds the status and role to their values', () => {
    const e = caseEntryFrom({
      id: 'e1',
      overviewId: 'o1',
      storyId: 's1',
      joinedBy: 'pipeline',
      joinedAt: new Date(0),
      status: 'gone',
      detachedBy: null,
      detachReason: null,
      detachedAt: null,
      locked: false,
      role: 'odd',
      roleKind: null,
      published: true,
      datePublished: null,
      title: 't',
      label: '',
      summary: '',
    })
    expect(e).toMatchObject({ status: 'active', role: 'routine' })
  })
})
