import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  pendingSubscription: { findMany: vi.fn() },
}))
const mockPlunk = vi.hoisted(() => ({ listContacts: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./plunk.js', () => mockPlunk)

const { reconcile, getSubscriberReconciliation } = await import('./subscribers.js')

// --- helpers -------------------------------------------------------------

const D = (iso: string) => new Date(iso)
const dbRow = (email: string, confirmedAt: Date | null, createdAt = D('2026-01-01T00:00:00Z')) => ({
  email,
  confirmedAt,
  createdAt,
})
const plunkContact = (email: string, subscribed: boolean, id = `id-${email}`) => ({ email, subscribed, id })

const rowFor = (rows: { email: string }[], email: string) =>
  rows.find((r) => r.email.toLowerCase() === email.toLowerCase())

// --- reconcile (pure) ----------------------------------------------------

describe('reconcile', () => {
  it('matches confirmed-in-DB + subscribed-in-Plunk as a single non-mismatch row', () => {
    const r = reconcile([dbRow('a@x.com', D('2026-02-01T00:00:00Z'))], [plunkContact('a@x.com', true)], true)
    expect(r.rows).toHaveLength(1)
    const row = rowFor(r.rows, 'a@x.com')!
    expect(row.dbStatus).toBe('confirmed')
    expect(row.plunkStatus).toBe('subscribed')
    expect(row.mismatch).toBe(false)
    expect(r.mismatches).toBe(0)
    expect(r.db).toEqual({ total: 1, confirmed: 1, pending: 0 })
  })

  it('flags confirmed-in-DB but unsubscribed-in-Plunk as a mismatch', () => {
    const r = reconcile([dbRow('a@x.com', D('2026-02-01T00:00:00Z'))], [plunkContact('a@x.com', false)], true)
    const row = rowFor(r.rows, 'a@x.com')!
    expect(row.plunkStatus).toBe('unsubscribed')
    expect(row.mismatch).toBe(true)
    expect(r.mismatches).toBe(1)
  })

  it('flags confirmed-in-DB but absent-from-Plunk as a mismatch (plunkStatus null)', () => {
    const r = reconcile([dbRow('a@x.com', D('2026-02-01T00:00:00Z'))], [], true)
    const row = rowFor(r.rows, 'a@x.com')!
    expect(row.plunkStatus).toBeNull()
    expect(row.mismatch).toBe(true)
  })

  it('includes a subscribed-in-Plunk-but-no-DB-row as a mismatch row', () => {
    const r = reconcile([], [plunkContact('ghost@x.com', true)], true)
    const row = rowFor(r.rows, 'ghost@x.com')!
    expect(row.dbStatus).toBeNull()
    expect(row.plunkStatus).toBe('subscribed')
    expect(row.mismatch).toBe(true)
  })

  it('collapses unsubscribed-in-Plunk-with-no-DB-row (never-confirmed bot) into a count, not a row', () => {
    const r = reconcile([], [plunkContact('bot@x.com', false)], true)
    expect(rowFor(r.rows, 'bot@x.com')).toBeUndefined()
    expect(r.rows).toHaveLength(0)
    expect(r.plunkCounts.unsubscribedNotInDb).toBe(1)
  })

  it('dedupes duplicate DB rows for one email, preferring the confirmed row', () => {
    const rows = [
      dbRow('dup@x.com', null, D('2026-03-01T00:00:00Z')), // pending, newer
      dbRow('dup@x.com', D('2026-02-01T00:00:00Z'), D('2026-02-01T00:00:00Z')), // confirmed, older
    ]
    const r = reconcile(rows, [], true)
    expect(r.rows).toHaveLength(1)
    expect(rowFor(r.rows, 'dup@x.com')!.dbStatus).toBe('confirmed')
    expect(r.db).toEqual({ total: 1, confirmed: 1, pending: 0 })
  })

  it('matches DB and Plunk case-insensitively', () => {
    const r = reconcile([dbRow('REAL@x.com', D('2026-02-01T00:00:00Z'))], [plunkContact('real@x.com', true)], true)
    expect(r.rows).toHaveLength(1)
    expect(rowFor(r.rows, 'real@x.com')!.mismatch).toBe(false)
  })

  it('counts plunk subscribed/unsubscribed totals over distinct emails', () => {
    const r = reconcile(
      [],
      [plunkContact('a@x.com', true), plunkContact('b@x.com', true), plunkContact('c@x.com', false)],
      true,
    )
    expect(r.plunkCounts).toMatchObject({ total: 3, subscribed: 2, unsubscribed: 1, unsubscribedNotInDb: 1 })
  })

  it('when Plunk is unavailable, shows DB-only rows with unknown plunk status and no mismatches', () => {
    const r = reconcile(
      [dbRow('a@x.com', D('2026-02-01T00:00:00Z')), dbRow('b@x.com', null)],
      [],
      false,
    )
    expect(r.rows).toHaveLength(2)
    for (const row of r.rows) expect(row.plunkStatus).toBeNull()
    expect(r.mismatches).toBe(0)
    expect(r.db).toEqual({ total: 2, confirmed: 1, pending: 1 })
  })
})

// --- getSubscriberReconciliation (Plunk fetch handling) ------------------

describe('getSubscriberReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.pendingSubscription.findMany.mockResolvedValue([])
  })

  it('marks plunk unavailable and still returns the DB side when the first listContacts call throws', async () => {
    mockPrisma.pendingSubscription.findMany.mockResolvedValue([dbRow('a@x.com', D('2026-02-01T00:00:00Z'))])
    mockPlunk.listContacts.mockRejectedValue(Object.assign(new Error('Request failed with status code 403'), {
      isAxiosError: true,
      response: { status: 403, data: { code: 'PROJECT_DISABLED' } },
    }))

    const result = await getSubscriberReconciliation()

    expect(result.plunk.available).toBe(false)
    expect(result.plunk.total).toBeNull()
    expect(result.rows).toHaveLength(1)
    expect(rowFor(result.rows, 'a@x.com')!.plunkStatus).toBeNull()
    expect(result.mismatches).toBe(0)
  })

  it('reads a page returned under a "contacts" key (defensive shape handling)', async () => {
    mockPlunk.listContacts.mockResolvedValue({ contacts: [plunkContact('a@x.com', true)], hasMore: false, nextCursor: null })

    const result = await getSubscriberReconciliation()

    expect(result.plunk.available).toBe(true)
    expect(result.plunk.total).toBe(1)
    expect(result.plunk.subscribed).toBe(1)
  })

  it('treats a page with neither items nor contacts as empty without throwing', async () => {
    mockPlunk.listContacts.mockResolvedValue({ hasMore: false, nextCursor: null })

    const result = await getSubscriberReconciliation()

    expect(result.plunk.available).toBe(true)
    expect(result.plunk.total).toBe(0)
  })

  it('returns partial results when a later page fails after an earlier page succeeded', async () => {
    mockPlunk.listContacts
      .mockResolvedValueOnce({ items: [plunkContact('a@x.com', true)], hasMore: true, nextCursor: 'c2' })
      .mockRejectedValueOnce(new Error('network blip'))

    const result = await getSubscriberReconciliation()

    expect(result.plunk.available).toBe(true)
    expect(result.plunk.partial).toBe(true)
    expect(result.plunk.subscribed).toBe(1)
  })

  it('stops and flags partial when Plunk repeats a pagination cursor (loop guard)', async () => {
    mockPlunk.listContacts
      .mockResolvedValueOnce({ items: [plunkContact('a@x.com', true)], hasMore: true, nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [plunkContact('b@x.com', true)], hasMore: true, nextCursor: 'c1' })

    const result = await getSubscriberReconciliation()

    expect(result.plunk.partial).toBe(true)
    expect(result.plunk.total).toBe(2)
  })

  it('coerces a non-boolean truthy "subscribed" value (defensive shape handling)', async () => {
    mockPlunk.listContacts.mockResolvedValue({ items: [{ email: 'a@x.com', subscribed: 'true', id: 'p1' }], hasMore: false, nextCursor: null })

    const result = await getSubscriberReconciliation()

    expect(result.plunk.subscribed).toBe(1)
  })

  it('aggregates contacts across multiple pages', async () => {
    mockPlunk.listContacts
      .mockResolvedValueOnce({ items: [plunkContact('a@x.com', true)], hasMore: true, nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [plunkContact('b@x.com', false)], hasMore: false, nextCursor: null })

    const result = await getSubscriberReconciliation()

    expect(result.plunk.total).toBe(2)
    expect(result.plunk.subscribed).toBe(1)
    expect(result.plunk.unsubscribed).toBe(1)
  })
})
