/**
 * Reading Plunk's contact list: walking all its pages, and what a contact's subscription flags say.
 * It imports nothing: the page request is passed in (`listContacts` in `plunk.ts`), so the operator
 * scripts can import it before they load their environment, and its tests need no HTTP mock.
 */

/** What paging reads of a contact-list page, as `listContacts` returns it beside the contacts. */
export interface CursorPage {
  nextCursor: string | null
  hasMore: boolean
}

/** Far beyond any real list (a million contacts at 100 a page): reaching it means paging is stuck. */
export const CONTACT_MAX_PAGES = 10_000

/**
 * Every page of Plunk's contact list, in order: `listPage(undefined, pageSize)`, then one request per
 * cursor. The next page is asked for only when the caller reads on, so a caller that stops early (a
 * page cap, a deadline) sends no request it does not use. A paging fault throws rather than end the
 * list, so it never passes for a complete one: a page that says more follow but carries no usable
 * cursor (missing, empty or not a string), a cursor seen before, or more pages after
 * `CONTACT_MAX_PAGES`. The errors name page numbers only, never a cursor or a contact.
 */
export async function* contactPages<P extends CursorPage>(
  listPage: (cursor: string | undefined, limit: number) => Promise<P>,
  pageSize: number,
): AsyncGenerator<P, void, undefined> {
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  for (let pages = 1; ; pages++) {
    const page = await listPage(cursor, pageSize)
    yield page
    if (!page.hasMore) return
    const next: unknown = page.nextCursor
    if (typeof next !== 'string' || !next) throw new Error(`Plunk reported more contacts after page ${pages} but sent no cursor`)
    if (seenCursors.has(next)) throw new Error(`Plunk repeated a cursor after page ${pages}`)
    if (pages >= CONTACT_MAX_PAGES) throw new Error(`stopped after ${CONTACT_MAX_PAGES} pages; paging looks stuck`)
    seenCursors.add(next)
    cursor = next
  }
}

/**
 * A contact's subscription as Plunk's flags give it. Plunk snoozes a contact by setting
 * `subscribed: false` with a `snoozedUntil` date, and subscribes it again when that date passes.
 */
export type ContactStatus = 'subscribed' | 'snoozed' | 'unsubscribed' | 'unknown'

/** Read strictly: a `subscribed` flag that is not a boolean is `unknown`, never taken for either side. */
export function contactStatus(contact: { subscribed?: unknown; snoozedUntil?: unknown }): ContactStatus {
  if (contact.subscribed === true) return 'subscribed'
  if (contact.subscribed !== false) return 'unknown'
  return contact.snoozedUntil != null ? 'snoozed' : 'unsubscribed'
}
