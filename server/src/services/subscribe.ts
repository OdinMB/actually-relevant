import { randomUUID } from 'crypto'
import axios from 'axios'
import prisma from '../lib/prisma.js'
import * as plunk from './plunk.js'
import { checkSendAllowance } from './subscribeLimits.js'
import { confirmationLinkExpiry, sendConfirmationEmail } from './confirmationEmail.js'
import type { NoticeInput } from './adminNotices.js'
import { notify } from '../lib/notify.js'
import { responseStatus } from '../lib/retry.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('subscribe')

export class EmailValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailValidationError'
  }
}

/** Thrown when the confirmation email could not be sent (e.g. the ESP is down or disabled). */
export class ConfirmationEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfirmationEmailError'
  }
}

/** A confirmation link that cannot confirm: `invalid` (no such token for the address) or `expired`. */
export class ConfirmationLinkError extends Error {
  constructor(readonly reason: 'invalid' | 'expired') {
    super(reason === 'expired' ? 'Confirmation link has expired' : 'Invalid confirmation link')
    this.name = 'ConfirmationLinkError'
  }
}

/**
 * The one form an address is stored and looked up in: trimmed and lowercased.
 * Nothing else (no Gmail dot or plus folding).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

interface SubscribeParams {
  email: string
}

export async function subscribe({ email: rawEmail }: SubscribeParams) {
  const email = normalizeEmail(rawEmail)
  const token = randomUUID()

  // A confirmed address is done unless Plunk shows a reader who left through its unsubscribe link: a
  // confirmed row stays here when they do, so Plunk is asked (`mayResubscribe`), and only then do
  // they sign up like anyone else below. That confirmed row stays as it is: only unconfirmed rows
  // are replaced, and the queue job skips a waiting signup only for a confirmation made after it.
  const confirmed = await prisma.pendingSubscription.findFirst({
    where: { email, confirmedAt: { not: null } },
    select: { id: true },
  })
  if (confirmed) {
    if (!(await mayResubscribe(email, confirmed.id))) return
    log.info({ subscriptionId: confirmed.id }, 'confirmed earlier but no longer subscribed in Plunk, signing up again')
  }

  // Send limits, before verification and any write or send. A throttled address gets
  // the same generic success as a real signup (the route cannot tell them apart), so a
  // bot learns nothing; nothing is written or sent. A queued signup gets that success
  // too, and its row waits for send_queued_confirmations.
  const allowance = await checkSendAllowance(email)
  if (allowance === 'address-limited') {
    log.info('confirmation email already sent within the window, sending nothing')
    return
  }

  // Email validation via Plunk. Best-effort: if the verify API errors (e.g. it is
  // unavailable or returns 403), log and proceed rather than blocking signups —
  // the route's bot gate (honeypot, form token, Turnstile), the send limits and
  // double opt-in are the backstop. Only an explicit validation failure (bad/disposable address)
  // rejects the subscription.
  try {
    const result = await plunk.verifyEmail(email)
    if (!result.valid || !result.domainExists) {
      throw new EmailValidationError('Please enter a valid email address.')
    }
    if (result.isDisposable) {
      throw new EmailValidationError('Disposable email addresses are not allowed. Please use a permanent email.')
    }
  } catch (err) {
    if (err instanceof EmailValidationError) throw err
    // Surface Plunk's actual response so a verify failure is diagnosable (the
    // axios message alone only says "status code 403"). Plunk's docs list only
    // 400/401 for verify, so a 403 likely means plan/quota gating or an edge
    // block — either way, verification is best-effort and we proceed.
    const detail = axios.isAxiosError(err) ? { status: err.response?.status, plunkResponse: err.response?.data } : {}
    log.warn({ err, ...detail }, 'email verification failed, skipping check')
  }

  // Delete any existing unconfirmed pending subscriptions for this email.
  // This handles the re-subscribe case: user gets a fresh token and a new
  // confirmation email instead of accumulating stale entries. Only rows made,
  // and sent if they were, before the per-address window can be here (a newer
  // one stopped us above), so the hourly count in checkSendAllowance is not affected.
  await prisma.pendingSubscription.deleteMany({
    where: { email, confirmedAt: null },
  })

  // Store the pending subscription; its plunkContactId stays null for now.
  // NOTE: sending the confirmation email DOES create a Plunk contact for this
  // address — Plunk creates a contact for every /v1/send recipient
  // (subscribed:false by default). So unconfirmed signups (including bots that
  // clear the gate) leave an *unsubscribed* Plunk contact behind; the
  // cleanup-plunk-contacts script purges the never-confirmed ones. On confirm,
  // that contact is upserted to subscribed:true.
  // A queued row has no sentAt and expires, unsent, a link lifetime from now;
  // send_queued_confirmations gives its link a full lifetime when it sends it.
  const now = new Date()
  const queued = allowance === 'queue'
  const pending = await prisma.pendingSubscription.create({
    data: {
      email,
      token,
      expiresAt: confirmationLinkExpiry(now),
      sentAt: queued ? null : now,
    },
  })
  if (queued) {
    log.info({ subscriptionId: pending.id }, 'hourly confirmation limit reached or signups waiting, signup queued')
    return
  }

  try {
    await sendConfirmationEmail(email, token)
    log.info({ subscriptionId: pending.id }, 'confirmation email sent')
  } catch (err) {
    log.error({ err, subscriptionId: pending.id }, 'failed to send confirmation email')
    // A row stands for exactly one sent email (the send limits count rows), so a
    // failed send must not leave one behind.
    await prisma.pendingSubscription.delete({ where: { id: pending.id } }).catch((deleteErr: unknown) => {
      log.error({ err: deleteErr, subscriptionId: pending.id }, 'failed to remove the pending row after a failed send')
    })
    throw new ConfirmationEmailError("We couldn't send the confirmation email right now. Please try again in a few minutes.")
  }
}

/**
 * Whether a confirmed address may sign up again: only when Plunk holds no contact for it, or only
 * plainly unsubscribed ones (`subscribed: false`, no snooze) with no spam complaint or bounce on
 * record. Plunk marks a complaint and a permanent bounce just like an unsubscribe and sends
 * transactional email regardless, so the activity record is what tells them apart; one more
 * complaint can disable the sending account. Anything else sends nothing: a contact still
 * subscribed, a snoozed one (Plunk resubscribes it when the snooze ends), a flag that is not a
 * boolean, a complaint or bounce on record, and a Plunk call that fails or cannot be read; that last
 * one also alerts the owner, since the reader is told to check their email and gets none. Logs name
 * the confirmed row's id only, never the address.
 */
async function mayResubscribe(email: string, subscriptionId: string): Promise<boolean> {
  let read: 'contact lookup' | 'activity read' = 'contact lookup'
  try {
    const contacts = await plunk.findContactsByEmail(email)
    if (contacts.some(contact => contact.subscribed !== false || contact.snoozedUntil != null)) {
      log.info({ subscriptionId }, 'already subscribed, returning success without action')
      return false
    }
    read = 'activity read'
    for (const contact of contacts) {
      if (await plunk.hasComplaintOrBounce(contact.id)) {
        log.warn({ subscriptionId }, 'Plunk has a spam complaint or a bounce on record for a confirmed address signing up again, sending nothing')
        return false
      }
    }
    return true
  } catch (err) {
    log.warn({ err, subscriptionId }, 'could not ask Plunk whether a confirmed address may sign up again, sending nothing')
    alertOwner({
      source: 'subscriptions',
      severity: 'warning',
      title: 'Returning reader got no confirmation email',
      message: `An address that confirmed before signed up again, but Plunk's ${read} failed (${plunkFailure(err)}), so the server could not tell whether it had left cleanly and sent no confirmation email. The reader was told to check their email. The count shows how many signups this hit. If it keeps coming back, check Plunk's status and that the API key can read contacts and activity; once Plunk answers, the reader can sign up again.`,
      link: '/admin/subscribers',
      dedupeKey: 'signup-returning-check-failed',
    })
    return false
  }
}

/**
 * Why a Plunk call failed, in words that carry nothing Plunk sent back (a notice must never quote
 * an address): its HTTP status, a timeout, a network error code, or an answer it could not read.
 */
function plunkFailure(err: unknown): string {
  const status = responseStatus(err)
  if (status !== undefined) return `HTTP ${status}`
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timed out'
  if (typeof code === 'string') return code
  return 'unreadable answer'
}

/** Record an owner notice without holding up the reply; `notify` never throws, the catch only guards that. */
function alertOwner(notice: NoticeInput): void {
  notify(notice).catch(() => {})
}

export async function confirmSubscription(token: string, rawEmail: string) {
  // Links sent before normalization may carry a mixed-case address.
  const email = normalizeEmail(rawEmail)
  const pending = await prisma.pendingSubscription.findFirst({
    where: { token, email },
  })

  if (!pending) {
    throw new ConfirmationLinkError('invalid')
  }

  if (pending.confirmedAt) {
    return // Already confirmed — idempotent
  }

  if (new Date() > pending.expiresAt) {
    throw new ConfirmationLinkError('expired')
  }

  // Upsert the Plunk contact to subscribed:true. The contact already exists —
  // the confirmation email's send created it as unsubscribed — so the
  // create-contact call updates it to subscribed (Plunk upserts on email).
  // Graceful: if Plunk fails, still mark confirmed locally, and tell the owner
  // once that is saved: the reader is told they are subscribed but Plunk has
  // them unsubscribed until someone fixes it.
  let plunkContactId: string | null = pending.plunkContactId
  let upsertFailure: { err: unknown } | null = null
  try {
    const contact = await plunk.createContact({ email, subscribed: true })
    plunkContactId = contact.id
  } catch (err) {
    upsertFailure = { err }
    log.warn({ err, subscriptionId: pending.id }, 'failed to create Plunk contact on confirm, marking confirmed anyway')
  }

  await prisma.pendingSubscription.update({
    where: { id: pending.id },
    data: { confirmedAt: new Date(), plunkContactId },
  })

  log.info({ subscriptionId: pending.id, plunkContactId }, 'subscription confirmed')

  if (upsertFailure) {
    alertOwner({
      source: 'subscriptions',
      severity: 'warning',
      title: 'Confirmed reader not subscribed in Plunk',
      message: `A reader confirmed their subscription, but marking their Plunk contact subscribed failed (${plunkFailure(upsertFailure.err)}). They were told they are subscribed and count as confirmed here, but Plunk sends the newsletter only to subscribed contacts. On the Subscribers page their row shows drift (confirmed here, not subscribed in Plunk), confirmed at the time of this notice; the count shows how many readers this hit. Subscribe the contact in Plunk, or ask them to sign up again, which sends a new confirmation link.`,
      link: '/admin/subscribers',
      dedupeKey: 'signup-confirm-plunk-failed',
    })
  }
}
