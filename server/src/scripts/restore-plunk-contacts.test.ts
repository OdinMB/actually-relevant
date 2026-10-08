import { describe, it, expect, vi } from 'vitest'
import {
  parseRestoreArgs,
  contactsFromBackup,
  findMissingContacts,
  restoreContacts,
} from './restore-plunk-contacts.js'

describe('parseRestoreArgs', () => {
  it('defaults to preview and requires --file', () => {
    expect(parseRestoreArgs(['--file=../DOCS/b.json'])).toEqual({ apply: false, file: '../DOCS/b.json' })
    expect(() => parseRestoreArgs([])).toThrow(/--file/)
    expect(() => parseRestoreArgs(['--file='])).toThrow()
  })

  it('reads --apply and rejects unknown flags', () => {
    expect(parseRestoreArgs(['--apply', '--file=b.json']).apply).toBe(true)
    expect(() => parseRestoreArgs(['--file=b.json', '--aply'])).toThrow()
  })
})

describe('contactsFromBackup', () => {
  it('returns the contacts of a backup', () => {
    expect(contactsFromBackup({ count: 1, contacts: [{ email: 'a@x.org' }] })).toEqual([{ email: 'a@x.org' }])
  })

  it('rejects a file that is not a backup or whose count disagrees', () => {
    expect(() => contactsFromBackup({})).toThrow()
    expect(() => contactsFromBackup(null)).toThrow()
    expect(() => contactsFromBackup({ count: 2, contacts: [{ email: 'a@x.org' }] })).toThrow()
  })
})

describe('findMissingContacts', () => {
  const current = [{ id: 'n1', email: 'Kept@X.org', subscribed: false }]

  it('lists backup contacts missing now, matched by lowercased email', () => {
    const backup = [
      { id: '1', email: 'kept@x.org', subscribed: true },
      { id: '2', email: 'Gone@X.org', subscribed: true, data: { source: 'import', score: 3, ok: true } },
      { id: '3', email: 'bot@x.org', subscribed: false },
    ]
    expect(findMissingContacts(backup, current)).toEqual([
      { email: 'Gone@X.org', subscribed: true, data: { source: 'import', score: 3, ok: true }, droppedDataKeys: [] },
      { email: 'bot@x.org', subscribed: false, data: {}, droppedDataKeys: [] },
    ])
  })

  it('never lists a contact that still exists, whatever its status now', () => {
    expect(findMissingContacts([{ email: 'kept@x.org', subscribed: true }], current)).toEqual([])
  })

  it('lists each email once and skips entries without an email', () => {
    const backup = [{ email: 'a@x.org', subscribed: true }, { email: 'A@x.org', subscribed: false }, { email: '' }, { id: 'z' }]
    expect(findMissingContacts(backup, []).map((m) => m.email)).toEqual(['a@x.org'])
  })

  it('never restores an unsubscribed contact as subscribed, whatever the flag spelling', () => {
    const backup = [
      { email: 'a@x.org', subscribed: false },
      { email: 'b@x.org', subscribed: 'false' },
      { email: 'c@x.org', subscribed: 0 },
      { email: 'd@x.org', subscribed: null },
      { email: 'e@x.org', subscribed: 'true' },
    ]
    expect(findMissingContacts(backup, []).map((m) => m.subscribed)).toEqual([false, false, false, false, true])
  })

  it('restores a missing subscribed flag as unsubscribed and leaves out non-primitive data', () => {
    const [m] = findMissingContacts([{ email: 'a@x.org', data: { nested: { a: 1 }, nil: null, name: 'A' } }], [])
    expect(m.subscribed).toBe(false)
    expect(m.data).toEqual({ name: 'A' })
    expect(m.droppedDataKeys).toEqual(['nested', 'nil'])
  })
})

describe('restoreContacts', () => {
  const missing = [
    { email: 'a@x.org', subscribed: true, data: { source: 'import' }, droppedDataKeys: [] },
    { email: 'b@x.org', subscribed: false, data: {}, droppedDataKeys: [] },
  ]

  it('preview never calls create', async () => {
    const create = vi.fn()
    expect(await restoreContacts(missing, { apply: false, create })).toEqual({ created: 0, failed: 0 })
    expect(create).not.toHaveBeenCalled()
  })

  it('apply recreates each missing contact with email, status and data', async () => {
    const create = vi.fn().mockResolvedValue({})
    expect(await restoreContacts(missing, { apply: true, create, log: () => {} })).toEqual({ created: 2, failed: 0 })
    expect(create).toHaveBeenNthCalledWith(1, { email: 'a@x.org', subscribed: true, data: { source: 'import' } })
    expect(create).toHaveBeenNthCalledWith(2, { email: 'b@x.org', subscribed: false })
  })

  it('counts a failure and carries on', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({})
    expect(await restoreContacts(missing, { apply: true, create, log: () => {} })).toEqual({ created: 1, failed: 1 })
  })
})
