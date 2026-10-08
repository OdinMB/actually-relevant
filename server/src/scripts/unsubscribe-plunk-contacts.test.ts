import { describe, it, expect, vi } from 'vitest'
import {
  parseUnsubscribeArgs,
  parseEmailList,
  classifyAddresses,
  countStatuses,
  applyUnsubscribes,
  describePlunkError,
  type ListedAddress,
} from './unsubscribe-plunk-contacts.js'

describe('parseUnsubscribeArgs', () => {
  it('defaults to preview and requires --file', () => {
    expect(parseUnsubscribeArgs(['--file=../DOCS/l.txt'])).toEqual({ apply: false, file: '../DOCS/l.txt' })
    expect(() => parseUnsubscribeArgs([])).toThrow(/--file/)
    expect(() => parseUnsubscribeArgs(['--file='])).toThrow()
  })

  it('reads --apply and rejects unknown flags', () => {
    expect(parseUnsubscribeArgs(['--apply', '--file=l.txt']).apply).toBe(true)
    expect(() => parseUnsubscribeArgs(['--file=l.txt', '--aply'])).toThrow()
  })
})

describe('parseEmailList', () => {
  it('skips blank lines and # comments, trims, lowercases and dedupes in order', () => {
    const text = '﻿# bots from the June wave\r\n  B@X.org \r\n\r\na@x.org\n# a@y.org\nb@x.org\n\n'
    expect(parseEmailList(text)).toEqual(['b@x.org', 'a@x.org'])
  })

  it('returns nothing for an empty or comment-only file', () => {
    expect(parseEmailList('')).toEqual([])
    expect(parseEmailList('# none\n\n')).toEqual([])
  })

  it('rejects a line that is not a single address, naming the line', () => {
    expect(() => parseEmailList('a@x.org\nnot-an-address\n')).toThrow(/line 2/)
    expect(() => parseEmailList('a@x.org, b@x.org')).toThrow(/line 1/)
    expect(() => parseEmailList('a@x.org b@x.org')).toThrow()
  })
})

describe('classifyAddresses', () => {
  const contacts = [
    { id: 's1', email: 'Sub@X.org', subscribed: true },
    { id: 'u1', email: 'unsub@x.org', subscribed: false, snoozedUntil: null },
    { id: 'z1', email: 'snooze@x.org', subscribed: false, snoozedUntil: '2026-11-01T00:00:00Z' },
    { id: 'q1', email: 'odd@x.org', subscribed: 'yes' },
    { email: 'noid@x.org', subscribed: true },
    { id: 'other', email: 'not-listed@x.org', subscribed: true },
  ]

  it('labels each listed address by the matching contact, by lowercased email', () => {
    const listed = classifyAddresses(['sub@x.org', 'unsub@x.org', 'snooze@x.org', 'gone@x.org'], contacts)
    expect(listed).toEqual([
      { email: 'sub@x.org', status: 'subscribed', id: 's1' },
      { email: 'unsub@x.org', status: 'unsubscribed', id: 'u1' },
      { email: 'snooze@x.org', status: 'snoozed', id: 'z1' },
      { email: 'gone@x.org', status: 'not-found' },
    ])
  })

  it('treats an unreadable flag or a missing id as unknown, never as subscribed', () => {
    expect(classifyAddresses(['odd@x.org', 'noid@x.org'], contacts).map((a) => a.status)).toEqual(['unknown', 'unknown'])
  })

  it('never returns a contact that is not on the list', () => {
    expect(classifyAddresses(['sub@x.org'], contacts).map((a) => a.id)).toEqual(['s1'])
  })

  it('refuses when two contacts share an address', () => {
    expect(() => classifyAddresses(['a@x.org'], [{ id: '1', email: 'a@x.org' }, { id: '2', email: 'A@x.org' }])).toThrow(/share/)
  })

  it('counts the statuses', () => {
    const listed = classifyAddresses(['sub@x.org', 'unsub@x.org', 'snooze@x.org', 'gone@x.org', 'odd@x.org'], contacts)
    expect(countStatuses(listed)).toEqual({ subscribed: 1, snoozed: 1, unsubscribed: 1, unknown: 1, notFound: 1 })
  })
})

describe('applyUnsubscribes', () => {
  const listed: ListedAddress[] = [
    { email: 'a@x.org', status: 'subscribed', id: 'a' },
    { email: 'b@x.org', status: 'unsubscribed', id: 'b' },
    { email: 'c@x.org', status: 'snoozed', id: 'c' },
    { email: 'd@x.org', status: 'not-found' },
    { email: 'e@x.org', status: 'unknown', id: 'e' },
    { email: 'f@x.org', status: 'subscribed', id: 'f' },
  ]
  const quiet = () => {}

  it('preview never calls the mutating function', async () => {
    const unsubscribe = vi.fn()
    expect(await applyUnsubscribes(listed, { apply: false, unsubscribe, log: quiet })).toEqual({ unsubscribed: 0, failed: 0, notAttempted: 0 })
    expect(unsubscribe).not.toHaveBeenCalled()
  })

  it('changes only the subscribed and snoozed contacts on the list, by id', async () => {
    const unsubscribe = vi.fn().mockResolvedValue({ subscribed: false, snoozedUntil: null })
    const result = await applyUnsubscribes(listed, { apply: true, unsubscribe, log: quiet })
    expect(unsubscribe.mock.calls.map((c) => c[0])).toEqual(['a', 'c', 'f'])
    expect(result).toEqual({ unsubscribed: 3, failed: 0, notAttempted: 0 })
  })

  it('counts a change Plunk does not confirm as failed', async () => {
    const unsubscribe = vi
      .fn()
      .mockResolvedValueOnce({ subscribed: false })
      .mockResolvedValueOnce({ subscribed: true })
      .mockResolvedValueOnce({ subscribed: false, snoozedUntil: '2026-11-01' })
    const lines: string[] = []
    const result = await applyUnsubscribes(listed, { apply: true, unsubscribe, log: (l) => lines.push(l) })
    expect(result).toEqual({ unsubscribed: 1, failed: 2, notAttempted: 0 })
    expect(lines.join('\n')).toMatch(/did not confirm/)
    expect(lines.join('\n')).toMatch(/snooze/)
  })

  it('stops after the first change fails and prints Plunk\'s error', async () => {
    const err = Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { success: false, error: { code: 'PROJECT_DISABLED', message: 'Project is disabled' } } },
    })
    const unsubscribe = vi.fn().mockRejectedValue(err)
    const lines: string[] = []
    const result = await applyUnsubscribes(listed, { apply: true, unsubscribe, log: (l) => lines.push(l) })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ unsubscribed: 0, failed: 1, notAttempted: 2 })
    expect(lines.join('\n')).toContain('HTTP 403: PROJECT_DISABLED: Project is disabled')
  })

  it('keeps going after a later failure', async () => {
    const unsubscribe = vi
      .fn()
      .mockResolvedValueOnce({ subscribed: false })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ subscribed: false })
    const result = await applyUnsubscribes(listed, { apply: true, unsubscribe, log: quiet })
    expect(unsubscribe).toHaveBeenCalledTimes(3)
    expect(result).toEqual({ unsubscribed: 2, failed: 1, notAttempted: 0 })
  })
})

describe('describePlunkError', () => {
  it('reads the common Plunk error bodies without a stack', () => {
    expect(describePlunkError({ response: { status: 404, data: { error: 'Contact not found' } } })).toBe('HTTP 404: Contact not found')
    expect(describePlunkError({ response: { status: 400, data: { message: 'Bad' } } })).toBe('HTTP 400: Bad')
    expect(describePlunkError({ response: { status: 502, data: '' } })).toBe('HTTP 502')
    expect(describePlunkError(new Error('socket hang up'))).toBe('socket hang up')
  })
})
