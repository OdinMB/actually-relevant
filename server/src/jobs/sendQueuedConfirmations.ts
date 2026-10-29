/**
 * The send_queued_confirmations job: sends the confirmation emails of the signups `subscribe()`
 * queued (over the hourly limit, or behind earlier ones still waiting), oldest first, never more
 * than the rolling hour has room for (`globalHourlyMax`, counted by `sent_at`). A signup that waited
 * past its expiry, or whose address confirmed meanwhile, is removed unsent. Nothing is sent while
 * signups are paused (SUBSCRIPTIONS_ENABLED). Each email is claimed before Plunk is called, so a
 * retry, an overlapping run or a crash never sends one twice; a failed send stops the run and fails
 * it, so the scheduler records a job-failure notice.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { provedNotSent } from '../lib/retry.js'
import { summarizeError } from '../utils/errors.js'
import { confirmationLinkExpiry, sendConfirmationEmail } from '../services/confirmationEmail.js'
import { remainingHourlyBudget, waitingSignupsWhere } from '../services/subscribeLimits.js'

const log = createLogger('send_queued_confirmations')

interface WaitingSignup {
  id: string
  email: string
  token: string
  expiresAt: Date
}

export async function runSendQueuedConfirmations(): Promise<void> {
  if (!config.subscribe.enabled) {
    log.info('signups are paused (SUBSCRIPTIONS_ENABLED), queued signups keep waiting')
    return
  }
  const now = new Date()

  const expired = await prisma.pendingSubscription.deleteMany({ where: { sentAt: null, confirmedAt: null, expiresAt: { lte: now } } })
  if (expired.count > 0) log.warn({ count: expired.count }, 'queued signups expired before their confirmation email could be sent')

  const budget = await remainingHourlyBudget(now)
  if (budget === 0) {
    log.info('the hourly confirmation limit is reached, queued signups keep waiting')
    return
  }
  const next: WaitingSignup[] = await prisma.pendingSubscription.findMany({
    where: waitingSignupsWhere(now),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: budget,
    select: { id: true, email: true, token: true, expiresAt: true },
  })
  if (next.length === 0) return

  const confirmed = await confirmedAddresses(next.map(row => row.email))
  let sent = 0
  let skipped = 0
  for (const row of next) {
    if (confirmed.has(row.email)) {
      await prisma.pendingSubscription.deleteMany({ where: { id: row.id, sentAt: null } })
      skipped++
    } else if (await sendOne(row)) {
      sent++
    }
  }
  log.info({ sent, skipped }, 'sent queued confirmation emails')
}

/** Of these addresses, the ones with a confirmed subscription. */
async function confirmedAddresses(emails: string[]): Promise<Set<string>> {
  const rows = await prisma.pendingSubscription.findMany({ where: { email: { in: emails }, confirmedAt: { not: null } }, select: { email: true } })
  return new Set(rows.map(row => row.email))
}

/**
 * Claim one waiting signup as sent, with a link that lives a full lifetime from now, then send its
 * email. False when the claim finds it gone or sent (a new signup for the address replaced it).
 * A failure that proves nothing went out puts it back in the queue; any other failure keeps it as
 * sent, since Plunk may have delivered it. Either way the run stops with an error naming no address.
 */
async function sendOne(row: WaitingSignup): Promise<boolean> {
  const sentAt = new Date()
  const claim = await prisma.pendingSubscription.updateMany({
    where: { id: row.id, sentAt: null },
    data: { sentAt, expiresAt: confirmationLinkExpiry(sentAt) },
  })
  if (claim.count === 0) return false

  try {
    await sendConfirmationEmail(row.email, row.token)
    return true
  } catch (err) {
    if (provedNotSent(err)) {
      await prisma.pendingSubscription.updateMany({ where: { id: row.id }, data: { sentAt: null, expiresAt: row.expiresAt } })
      log.warn({ err, subscriptionId: row.id }, 'queued confirmation email not sent, the signup waits for the next run')
    } else {
      log.error({ err, subscriptionId: row.id }, 'queued confirmation email outcome unknown, kept as sent so it is never sent twice')
    }
    throw new Error(`A queued confirmation email failed to send (${summarizeError(err)}); the remaining signups wait for the next run`, { cause: err })
  }
}
