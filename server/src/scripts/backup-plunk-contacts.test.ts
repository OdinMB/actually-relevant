import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import {
  chooseBackupFileName,
  fetchAllContacts,
  summarizeContacts,
  DOCS_DIR,
  type ContactsPage,
} from './backup-plunk-contacts.js'

describe('chooseBackupFileName', () => {
  const now = new Date('2026-10-08T23:45:07.000Z')

  it('uses the UTC date when the name is free', () => {
    expect(chooseBackupFileName(now, () => false)).toBe('2026-10-08_plunk-contacts-backup.json')
  })

  it('adds -HHMM rather than overwrite', () => {
    const taken = new Set(['2026-10-08_plunk-contacts-backup.json'])
    expect(chooseBackupFileName(now, (n) => taken.has(n))).toBe('2026-10-08_plunk-contacts-backup-2345.json')
  })

  it('falls back to seconds and then a counter, never an existing name', () => {
    const taken = new Set([
      '2026-10-08_plunk-contacts-backup.json',
      '2026-10-08_plunk-contacts-backup-2345.json',
      '2026-10-08_plunk-contacts-backup-234507.json',
      '2026-10-08_plunk-contacts-backup-234507-2.json',
    ])
    expect(chooseBackupFileName(now, (n) => taken.has(n))).toBe('2026-10-08_plunk-contacts-backup-234507-3.json')
  })

  it('uses UTC, not the local date', () => {
    expect(chooseBackupFileName(new Date('2026-01-01T00:30:00+02:00'), () => false)).toBe(
      '2025-12-31_plunk-contacts-backup.json',
    )
  })
})

describe('DOCS_DIR', () => {
  it('is the repository root DOCS folder', () => {
    expect(path.basename(DOCS_DIR)).toBe('DOCS')
    expect(path.basename(path.dirname(DOCS_DIR))).not.toBe('server')
  })
})

const page = (items: ContactsPage['items'], more: Partial<ContactsPage> = {}): ContactsPage => ({
  items,
  nextCursor: null,
  hasMore: false,
  total: items.length,
  ...more,
})

describe('fetchAllContacts', () => {
  it('pages through all cursors and keeps every field Plunk returned', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: '1', email: 'a@x.org', subscribed: true, data: { src: 'import' } }], { hasMore: true, nextCursor: 'c1', total: 2 }))
      .mockResolvedValueOnce(page([{ id: '2', email: 'b@x.org', subscribed: false, extra: 42 }], { total: 2 }))
    const result = await fetchAllContacts(listPage, 1)
    expect(listPage).toHaveBeenNthCalledWith(1, undefined, 1)
    expect(listPage).toHaveBeenNthCalledWith(2, 'c1', 1)
    expect(result.contacts).toEqual([
      { id: '1', email: 'a@x.org', subscribed: true, data: { src: 'import' } },
      { id: '2', email: 'b@x.org', subscribed: false, extra: 42 },
    ])
    expect(result.pages).toBe(2)
    expect(result.reportedTotal).toBe(2)
  })

  it('treats a total equal to the first page length as unknown when more pages follow', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page([{ id: '1' }], { hasMore: true, nextCursor: 'c1', total: 1 }))
      .mockResolvedValueOnce(page([{ id: '2' }]))
    expect((await fetchAllContacts(listPage, 1)).reportedTotal).toBeNull()
  })

  it('throws when more pages are announced without a cursor', async () => {
    const listPage = vi.fn().mockResolvedValueOnce(page([{ id: '1' }], { hasMore: true, nextCursor: null }))
    await expect(fetchAllContacts(listPage)).rejects.toThrow(/no cursor/)
  })

  it('throws when Plunk repeats a cursor', async () => {
    const listPage = vi.fn().mockResolvedValue(page([{ id: '1' }], { hasMore: true, nextCursor: 'same' }))
    await expect(fetchAllContacts(listPage)).rejects.toThrow(/repeated a cursor/)
  })
})

describe('summarizeContacts', () => {
  it('counts statuses, duplicates and missing emails', () => {
    expect(
      summarizeContacts([
        { id: '1', email: 'a@x.org', subscribed: true },
        { id: '2', email: 'b@x.org', subscribed: false },
        { id: '2', email: 'b@x.org', subscribed: false },
        { id: '3', email: '', subscribed: 'yes' },
      ]),
    ).toEqual({ count: 4, subscribed: 1, unsubscribed: 2, unknownStatus: 1, duplicateIds: 1, missingEmail: 1 })
  })
})
