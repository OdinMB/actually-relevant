import type { Newsletter, NewsletterSend } from '@shared/types'

/** What the admin's newsletter buttons need to know about an issue's sends. */
export interface NewsletterSendState {
  /** A live send that is not failed exists: the issue went out (or may have), and cannot be sent again. */
  liveSent: boolean
  /** A live send is unconfirmed (stored as `draft`): Plunk may or may not have sent it. */
  unconfirmed: boolean
  /** Build moves and edits are refused: unconfirmed, or sent and published. */
  frozen: boolean
  /** A test email of the current HTML went out, which the live send needs. */
  testCurrent: boolean
}

/**
 * The server's lifecycle rule (`server/src/services/newsletterLifecycle.ts`), mirrored from the send
 * list for button states only; the server's 409 stays the authority.
 */
export function newsletterSendState(newsletter: Pick<Newsletter, 'status' | 'html'>, sends: NewsletterSend[] | undefined): NewsletterSendState {
  const live = (sends ?? []).filter(send => !send.isTest && send.status !== 'failed')
  const liveSent = live.length > 0
  const unconfirmed = live.some(send => send.status === 'draft')
  const testCurrent = !!newsletter.html && (sends ?? []).some(send => send.isTest && send.status === 'sent' && send.htmlContent === newsletter.html)
  return { liveSent, unconfirmed, frozen: unconfirmed || (liveSent && newsletter.status === 'published'), testCurrent }
}
