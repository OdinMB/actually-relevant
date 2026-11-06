/**
 * Switching a subscriber's edition from an issue's footer link (ADR-0052, `.context/subscription.md`,
 * "Editions"). The link opens `/newsletter-edition` with the contact id Plunk filled in and the edition
 * it offers; that page posts them only when the reader clicks its button, never on load, so a link
 * scanner that runs JavaScript switches nobody.
 *
 * Refused: while the editions are closed (409); a link whose contact id Plunk did not fill in (400,
 * and one owner notice, since every link in that issue is then broken); a contact Plunk does not have
 * (404); and one not subscribed (409), which is never written, so a switch can never resubscribe
 * anyone. Otherwise the contact's `edition` field is written, merged with the rest of its data so no
 * other field is lost whatever Plunk's PATCH does with `data`; a switch to the edition the contact is
 * on already writes nothing. Logs and notices never carry the contact id or the address.
 */
import type { NewsletterEdition } from '@prisma/client'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { responseStatus } from '../lib/retry.js'
import { ServiceError } from '../utils/errors.js'
import * as plunk from './plunk.js'
import { contactStatus } from './plunkContacts.js'

const log = createLogger('edition-switch')

export type EditionSwitchRefusal = 'closed' | 'broken_link' | 'unknown_contact' | 'not_subscribed'

/** A switch the link or the contact does not allow; the page tells the reader by `code`. */
export class EditionSwitchError extends ServiceError {
  constructor(
    readonly code: EditionSwitchRefusal,
    message: string,
    status: number,
  ) {
    super(message, status)
  }

  toBody(): Record<string, unknown> {
    return { error: this.message, code: this.code }
  }
}

/** A template variable Plunk left as it was: the link holds braces instead of a contact id. */
const UNFILLED = /[{}]/

/** The contact's data fields Plunk can store back as they are (strings, numbers, booleans). */
function storableData(data: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> {
  const kept: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') kept[key] = value
  }
  return kept
}

/** Put the subscribed contact on `edition`; refuses as the module comment says. */
export async function switchEdition(contactId: string, edition: NewsletterEdition): Promise<void> {
  if (!config.newsletter.editionsOpen) {
    throw new EditionSwitchError('closed', 'Switching editions is not available right now.', 409)
  }
  if (UNFILLED.test(contactId)) {
    log.warn('edition switch link reached the server with its contact id not filled in')
    notify({
      source: 'subscriptions',
      severity: 'warning',
      title: 'Edition switch link not filled in by Plunk',
      message:
        'A reader opened an issue\'s "switch edition" link whose contact id Plunk had not filled in, so the link carried the template variable itself. Every switch link in that issue is broken: check in Plunk that campaign bodies still fill in {{id}}, and send a [TEST] email to see the link before the next issue.',
      link: '/admin/newsletters',
      dedupeKey: 'edition-switch-link-broken',
    }).catch(() => {})
    throw new EditionSwitchError('broken_link', 'This link is broken.', 400)
  }

  let contact: plunk.Contact | null
  try {
    contact = await plunk.getContact(contactId)
  } catch (err) {
    throw plunkFailure('read the contact', err)
  }
  if (!contact) throw new EditionSwitchError('unknown_contact', 'This link does not belong to a subscriber.', 404)
  if (contactStatus(contact) !== 'subscribed') {
    throw new EditionSwitchError('not_subscribed', 'This address is not subscribed to the newsletter.', 409)
  }
  if (contact.data?.edition === edition) return

  try {
    await plunk.updateContact(contactId, { data: { ...storableData(contact.data), edition } })
  } catch (err) {
    throw plunkFailure("write the contact's edition", err)
  }
  log.info({ edition }, 'subscriber switched edition')
}

/**
 * A failed Plunk call as an error that carries its status only: the axios error holds the request's
 * path, with the contact id in it, and the route's error log would print it.
 */
function plunkFailure(what: string, err: unknown): Error {
  const status = responseStatus(err)
  log.warn({ status }, `edition switch: could not ${what} in Plunk`)
  return new Error(`edition switch: could not ${what} in Plunk (${status === undefined ? 'no answer' : `HTTP ${status}`})`)
}
