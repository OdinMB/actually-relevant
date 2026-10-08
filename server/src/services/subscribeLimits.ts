import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { notifyEvent } from '../lib/notify.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('subscribe-limits')

const HOUR_MS = 60 * 60 * 1000

/**
 * `ok`: a confirmation email may be sent now.
 * `address-limited`: this address got one within the per-address window; send nothing.
 * `global-cap`: the hourly cap across all addresses is reached; refuse the signup.
 */
export type SendAllowance = 'ok' | 'address-limited' | 'global-cap'

// Module-level, so a deploy resets it: at most one extra alert per deploy.
let lastCapAlertAt = 0

/**
 * Decide whether a confirmation email may go to `email` (already normalized) now.
 * Both limits count `pending_subscriptions` rows, one per sent confirmation email
 * (`subscribe()` deletes the row again when the send fails), so they hold across
 * deploys and instances.
 */
export async function checkSendAllowance(email: string): Promise<SendAllowance> {
  const now = Date.now()

  const recentForAddress = await prisma.pendingSubscription.findFirst({
    where: {
      email,
      confirmedAt: null,
      createdAt: { gt: new Date(now - config.subscribe.perAddressWindowHours * HOUR_MS) },
    },
    select: { id: true },
  })
  if (recentForAddress) return 'address-limited'

  const sentLastHour = await prisma.pendingSubscription.count({
    where: { createdAt: { gt: new Date(now - HOUR_MS) } },
  })
  if (sentLastHour >= config.subscribe.globalHourlyMax) {
    await alertCapReached(sentLastHour, now)
    return 'global-cap'
  }

  return 'ok'
}

async function alertCapReached(sentLastHour: number, now: number): Promise<void> {
  if (now - lastCapAlertAt < HOUR_MS) return
  lastCapAlertAt = now
  log.warn({ sentLastHour }, 'newsletter signup cap reached')
  await notifyEvent(
    'Newsletter signup cap reached',
    `${sentLastHour} confirmation emails in the last hour; new signups are refused until the hour passes.`,
  )
}
