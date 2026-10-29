import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { notify } from '../lib/notify.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('subscribe-limits')

const HOUR_MS = 60 * 60 * 1000

/**
 * `ok`: a confirmation email may be sent now.
 * `address-limited`: this address got one, or signed up, within the per-address window; send nothing.
 * `queue`: the hour has no room, or earlier signups are still waiting; accept the signup and let
 * send_queued_confirmations send its email, oldest first.
 */
export type SendAllowance = 'ok' | 'address-limited' | 'queue'

// Module-level, so a deploy resets it: at most one extra alert per deploy.
let lastCapAlertAt = 0

/**
 * The signups waiting for their confirmation email: no email sent yet, and not expired. A waiting
 * signup expires a link lifetime after it was made (`subscribe()` sets `expiresAt`), unsent.
 */
export function waitingSignupsWhere(now: Date): Prisma.PendingSubscriptionWhereInput {
  return { sentAt: null, confirmedAt: null, expiresAt: { gt: now } }
}

/** Confirmation emails sent in the rolling hour before `now`: one per row with `sentAt` in it. */
function sentInLastHour(now: Date): Promise<number> {
  return prisma.pendingSubscription.count({ where: { sentAt: { gt: new Date(now.getTime() - HOUR_MS) } } })
}

/** How many more confirmation emails the rolling hour has room for. */
export async function remainingHourlyBudget(now: Date): Promise<number> {
  return Math.max(0, config.subscribe.globalHourlyMax - (await sentInLastHour(now)))
}

/**
 * Decide what happens to a signup for `email` (already normalized) now. Both limits count
 * `pending_subscriptions` rows, so they hold across deploys and instances: the per-address window
 * any row for the address, sent or waiting; the hourly limit the rows sent in the last hour (a row
 * stands for one sent email; `subscribe()` deletes it again when a direct send fails).
 */
export async function checkSendAllowance(email: string): Promise<SendAllowance> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - config.subscribe.perAddressWindowHours * HOUR_MS)

  const recentForAddress = await prisma.pendingSubscription.findFirst({
    where: { email, confirmedAt: null, OR: [{ createdAt: { gt: windowStart } }, { sentAt: { gt: windowStart } }] },
    select: { id: true },
  })
  if (recentForAddress) return 'address-limited'

  const sentLastHour = await sentInLastHour(now)
  if (sentLastHour >= config.subscribe.globalHourlyMax) {
    await alertCapReached(sentLastHour, now)
    return 'queue'
  }

  // Room in the hour, but earlier signups still wait: join the queue behind them, so emails go out
  // oldest first and a steady stream of new signups never starves the queue.
  const waiting = await prisma.pendingSubscription.findFirst({ where: waitingSignupsWhere(now), select: { id: true } })
  return waiting ? 'queue' : 'ok'
}

async function alertCapReached(sentLastHour: number, now: Date): Promise<void> {
  if (now.getTime() - lastCapAlertAt < HOUR_MS) return
  lastCapAlertAt = now.getTime()
  const waiting = await prisma.pendingSubscription.count({ where: waitingSignupsWhere(now) })
  log.warn({ sentLastHour, waiting }, 'newsletter signup cap reached, queueing signups')
  await notify({
    source: 'subscriptions',
    severity: 'warning',
    title: 'Newsletter signup cap reached',
    message: `${sentLastHour} confirmation emails in the last hour. New signups are accepted and queued (${waiting} already waiting); send_queued_confirmations sends them oldest first, at most ${config.subscribe.globalHourlyMax} an hour.`,
    link: '/admin/subscribers',
    dedupeKey: 'signup-cap',
  })
}
