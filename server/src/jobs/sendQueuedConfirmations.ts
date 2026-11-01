/**
 * The send_queued_confirmations job: sends the confirmation emails of the signups `subscribe()`
 * queued (over the hourly limit, or behind earlier ones still waiting), oldest first, never more
 * than the rolling hour has room for (`globalHourlyMax`, counted by `sent_at`). A signup that waited
 * past its expiry (the owner is told how many), or whose address confirmed after it was made, is
 * removed unsent. Nothing is sent while signups are paused (SUBSCRIPTIONS_ENABLED). Each email is
 * claimed before Plunk is called, so a retry, an overlapping run or a crash never sends one twice.
 * A signup Plunk refuses as invalid is removed and the run carries on, unless Plunk refused two or
 * more and the run sent none: then the refusal is Plunk's, not the addresses', so they are kept for a
 * later run and the owner is told. Any other failed send stops the run. Either fails the run, so the
 * scheduler records a job-failure notice.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { provedNotSent, responseStatus } from '../lib/retry.js'
import { summarizeError } from '../utils/errors.js'
import { confirmationLinkExpiry, sendConfirmationEmail } from '../services/confirmationEmail.js'
import { remainingHourlyBudget, waitingSignupsWhere } from '../services/subscribeLimits.js'

const log = createLogger('send_queued_confirmations')

/**
 * Plunk's answers that refuse this one request as invalid (400 bad request, 422 failed validation).
 * Each request carries one recipient, so sending it again would only be refused again, and it would
 * hold up every signup behind it. Any other 4xx (401, 403 for a disabled project, 429) concerns the
 * account or the rate, and the signup waits for the next run.
 */
const REFUSED_AS_INVALID = new Set([400, 422])

/**
 * How many refusals, in a run that sent nothing, make the cause Plunk's (a changed validation rule,
 * the template, the sender) rather than the addresses', so the refused signups are kept. One refusal
 * alone cannot tell the two apart, so a single bad address is still removed.
 */
const REFUSALS_THAT_BLAME_PLUNK = 2

interface WaitingSignup {
  id: string
  email: string
  token: string
  createdAt: Date
  expiresAt: Date
}

interface Refusal {
  id: string
  status: number
}

/**
 * What became of one claimed signup: sent, gone before the claim, refused as invalid (back in the
 * queue until the run decides), or a failure that stops the run.
 */
type SendOutcome = { kind: 'sent' } | { kind: 'gone' } | ({ kind: 'refused' } & Refusal) | { kind: 'stop'; err: unknown }

export async function runSendQueuedConfirmations(): Promise<void> {
  if (!config.subscribe.enabled) {
    log.debug('signups are paused (SUBSCRIPTIONS_ENABLED), queued signups keep waiting')
    return
  }
  const now = new Date()

  await removeExpired(now)

  const budget = await remainingHourlyBudget(now)
  if (budget === 0) {
    log.info('the hourly confirmation limit is reached, queued signups keep waiting')
    return
  }
  const next: WaitingSignup[] = await prisma.pendingSubscription.findMany({
    where: waitingSignupsWhere(now),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: budget,
    select: { id: true, email: true, token: true, createdAt: true, expiresAt: true },
  })
  if (next.length === 0) return

  const latestConfirmed = await latestConfirmations(next.map(row => row.email))
  let sent = 0
  let skipped = 0
  const refused: Refusal[] = []
  let stop: { err: unknown } | null = null
  for (const row of next) {
    if (confirmedSince(latestConfirmed.get(row.email), row)) {
      await prisma.pendingSubscription.deleteMany({ where: { id: row.id, sentAt: null } })
      skipped++
      continue
    }
    const outcome = await sendOne(row)
    if (outcome.kind === 'sent') sent++
    else if (outcome.kind === 'refused') refused.push({ id: outcome.id, status: outcome.status })
    else if (outcome.kind === 'stop') {
      stop = { err: outcome.err }
      break
    }
  }
  log.info({ sent, skipped, refused: refused.length }, 'sent queued confirmation emails')

  const keepRefused = sent === 0 && refused.length >= REFUSALS_THAT_BLAME_PLUNK
  if (keepRefused) await alertRefusedAll(refused)
  else if (refused.length > 0) await removeRefused(refused)

  const failures: string[] = []
  if (stop) failures.push(`A queued confirmation email failed to send (${summarizeError(stop.err)}); the remaining signups wait for the next run`)
  if (refused.length > 0) failures.push(refusedSummary(refused, keepRefused))
  if (failures.length > 0) throw new Error(failures.join('. '), { cause: stop?.err })
}

/** Remove the signups Plunk refused as invalid in a run that sent other emails: the refusal was theirs. */
async function removeRefused(refused: Refusal[]): Promise<void> {
  // Only rows still waiting: a row another run claimed meanwhile is that run's
  await prisma.pendingSubscription.deleteMany({ where: { id: { in: refused.map(r => r.id) }, sentAt: null } })
  log.warn({ count: refused.length }, 'queued signups Plunk refused as invalid are removed unsent')
}

/**
 * Plunk refused two or more emails and the run sent none, so the refused signups stay in the queue
 * (`sendOne` put them back): tell the owner, by count and status only, that nothing was removed and
 * what still bounds the wait.
 */
async function alertRefusedAll(refused: Refusal[]): Promise<void> {
  const n = refused.length
  log.warn({ count: n }, 'Plunk refused queued confirmation emails and the run sent none, the signups are kept for the next run')
  await notify({
    source: 'subscriptions',
    severity: 'warning',
    title: 'Queued confirmation emails refused, signups kept',
    message: `Plunk refused ${n} queued confirmation emails in one run (HTTP ${statusList(refused)}) and the run sent none. A refusal of every email points at Plunk's side (a changed validation rule, the template or the sender), not at the addresses, so none of these signups was removed: send_queued_confirmations tries them again on its next runs, and each is still removed unsent ${config.subscribe.confirmTokenExpiryHours} hours after signing up. Check the Plunk dashboard and the job's log for the reason.`,
    link: '/admin/subscribers',
    dedupeKey: 'signup-queue-refused',
  })
}

/** Remove the waiting signups past their expiry, unsent, and tell the owner how many: each was told its email was on its way. */
async function removeExpired(now: Date): Promise<void> {
  const { count } = await prisma.pendingSubscription.deleteMany({ where: { sentAt: null, confirmedAt: null, expiresAt: { lte: now } } })
  if (count === 0) return
  log.warn({ count }, 'queued signups expired before their confirmation email could be sent')
  await notify({
    source: 'subscriptions',
    severity: 'warning',
    title: 'Queued signups expired unsent',
    message: `${count} queued ${count === 1 ? 'signup' : 'signups'} waited ${config.subscribe.confirmTokenExpiryHours} hours without a confirmation email and ${count === 1 ? 'was' : 'were'} removed unsent. They were told the email was on its way; they can sign up again.`,
    link: '/admin/subscribers',
    dedupeKey: 'signup-queue-expired',
  })
}

/** Of these addresses, the ones with a confirmed subscription, each with its latest confirmation. */
async function latestConfirmations(emails: string[]): Promise<Map<string, Date>> {
  const rows = await prisma.pendingSubscription.findMany({
    where: { email: { in: emails }, confirmedAt: { not: null } },
    select: { email: true, confirmedAt: true },
  })
  const latest = new Map<string, Date>()
  for (const { email, confirmedAt } of rows) {
    const known = latest.get(email)
    if (confirmedAt && (!known || confirmedAt > known)) latest.set(email, confirmedAt)
  }
  return latest
}

/**
 * True when the address confirmed at or after this signup was made, so its email is not needed. A
 * confirmation from before it belongs to a reader who has since unsubscribed: `subscribe()` queues a
 * confirmed address only once Plunk has it unsubscribed.
 */
function confirmedSince(confirmedAt: Date | undefined, row: WaitingSignup): boolean {
  return confirmedAt !== undefined && confirmedAt >= row.createdAt
}

/** The refusals' statuses, each once, in order: "400, 422". */
function statusList(refused: Refusal[]): string {
  return [...new Set(refused.map(r => r.status))].sort((a, b) => a - b).join(', ')
}

/** "N queued signups refused by Plunk (HTTP 400, 422) and removed", or "… and kept for the next run, …". */
function refusedSummary(refused: Refusal[], kept: boolean): string {
  const n = refused.length
  const fate = kept ? 'kept for the next run, since the run sent none' : 'removed'
  return `${n} queued ${n === 1 ? 'signup' : 'signups'} refused by Plunk (HTTP ${statusList(refused)}) and ${fate}`
}

/**
 * Claim one waiting signup as sent, with a link that lives a full lifetime from now, then send its
 * email. `gone` when the claim finds it removed or sent (a new signup for the address replaced it).
 * A failure that proves nothing went out puts it back in the queue with its old expiry: a refusal as
 * invalid until the run decides whether to remove it, anything else for the next run. Any other
 * failure keeps it as sent, since Plunk may have delivered it. Logs name the signup by id only,
 * never its address.
 */
async function sendOne(row: WaitingSignup): Promise<SendOutcome> {
  const sentAt = new Date()
  const claim = await prisma.pendingSubscription.updateMany({
    where: { id: row.id, sentAt: null },
    data: { sentAt, expiresAt: confirmationLinkExpiry(sentAt) },
  })
  if (claim.count === 0) return { kind: 'gone' }

  try {
    await sendConfirmationEmail(row.email, row.token)
    return { kind: 'sent' }
  } catch (err) {
    if (provedNotSent(err)) {
      await prisma.pendingSubscription.updateMany({ where: { id: row.id }, data: { sentAt: null, expiresAt: row.expiresAt } })
      const status = responseStatus(err)
      if (status !== undefined && REFUSED_AS_INVALID.has(status)) {
        log.warn({ subscriptionId: row.id, status }, 'Plunk refused a queued confirmation email as invalid')
        return { kind: 'refused', id: row.id, status }
      }
      log.warn({ err, subscriptionId: row.id }, 'queued confirmation email not sent, the signup waits for the next run')
    } else {
      log.error({ err, subscriptionId: row.id }, 'queued confirmation email outcome unknown, kept as sent so it is never sent twice')
    }
    return { kind: 'stop', err }
  }
}
