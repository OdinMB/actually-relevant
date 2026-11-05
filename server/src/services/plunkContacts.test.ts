import { describe, it, expect, vi } from 'vitest'
import { contactPages, contactStatus, CONTACT_MAX_PAGES, type CursorPage } from './plunkContacts.js'

type Page = CursorPage & { items: string[] }

const page = (items: string[], nextCursor: string | null = null, hasMore = nextCursor !== null): Page => ({ items, nextCursor, hasMore })

async function readAll(pages: AsyncIterable<Page>): Promise<string[]> {
  const items: string[] = []
  for await (const p of pages) items.push(...p.items)
  return items
}

describe('contactPages', () => {
  it('asks for the first page without a cursor, then follows each cursor with the same page size', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], 'c2'))
      .mockResolvedValueOnce(page(['c']))

    expect(await readAll(contactPages(listPage, 100))).toEqual(['a', 'b', 'c'])
    expect(listPage.mock.calls).toEqual([
      [undefined, 100],
      ['c1', 100],
      ['c2', 100],
    ])
  })

  it('ends after a page that says no more follow, whatever cursor it carries', async () => {
    const listPage = vi.fn().mockResolvedValueOnce(page(['a'], 'stale', false))

    expect(await readAll(contactPages(listPage, 100))).toEqual(['a'])
    expect(listPage).toHaveBeenCalledTimes(1)
  })

  it('asks for no page the caller does not read', async () => {
    const listPage = vi.fn().mockResolvedValue(page(['a'], 'c1'))

    for await (const p of contactPages(listPage, 100)) {
      expect(p.items).toEqual(['a'])
      break
    }
    expect(listPage).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no cursor', null],
    ['an empty cursor', ''],
  ])('throws, naming the page, when a page says more follow but carries %s', async (_label, cursor) => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], cursor, true))

    await expect(readAll(contactPages(listPage, 100))).rejects.toThrow('Plunk reported more contacts after page 2 but sent no cursor')
    expect(listPage).toHaveBeenCalledTimes(2)
  })

  it('throws when a cursor that is not a string comes through an untyped page', async () => {
    const malformed = { items: ['a'], nextCursor: 42, hasMore: true } as unknown as Page
    const listPage = vi.fn().mockResolvedValueOnce(malformed)

    await expect(readAll(contactPages(listPage, 100))).rejects.toThrow(/sent no cursor/)
  })

  it('throws when a cursor comes back, also one seen pages earlier, instead of reading the same pages again', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockResolvedValueOnce(page(['b'], 'c2'))
      .mockResolvedValueOnce(page(['c'], 'c1'))

    await expect(readAll(contactPages(listPage, 100))).rejects.toThrow('Plunk repeated a cursor after page 3')
    expect(listPage).toHaveBeenCalledTimes(3)
  })

  it('throws instead of paging on without end', async () => {
    let n = 0
    const listPage = vi.fn(async () => page([], `c${++n}`))

    await expect(readAll(contactPages(listPage, 100))).rejects.toThrow(/paging looks stuck/)
    expect(listPage).toHaveBeenCalledTimes(CONTACT_MAX_PAGES)
  })

  it('passes on a failed page request as it is', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockRejectedValueOnce(new Error('network blip'))

    await expect(readAll(contactPages(listPage, 100))).rejects.toThrow('network blip')
  })
})

describe('contactStatus', () => {
  it.each([
    [{ subscribed: true }, 'subscribed'],
    [{ subscribed: true, snoozedUntil: '2026-12-01T00:00:00Z' }, 'subscribed'],
    [{ subscribed: false }, 'unsubscribed'],
    [{ subscribed: false, snoozedUntil: null }, 'unsubscribed'],
    [{ subscribed: false, snoozedUntil: '2026-12-01T00:00:00Z' }, 'snoozed'],
  ])('reads %j as %s', (contact, status) => {
    expect(contactStatus(contact)).toBe(status)
  })

  it.each([[{ subscribed: 'true' }], [{ subscribed: 1 }], [{ subscribed: 'yes' }], [{ subscribed: null }], [{}]])(
    'reads a flag that is not a boolean, %j, as unknown, never as either side',
    contact => {
      expect(contactStatus(contact)).toBe('unknown')
    },
  )
})
