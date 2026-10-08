import { randomUUID } from 'crypto'
import axios from 'axios'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import * as plunk from './plunk.js'
import { checkSendAllowance } from './subscribeLimits.js'
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

/** Thrown when the global hourly cap on confirmation emails is reached. */
export class SignupUnavailableError extends Error {
  constructor(message = 'Signups are unavailable right now. Please try again later.') {
    super(message)
    this.name = 'SignupUnavailableError'
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
  const expiresAt = new Date(Date.now() + config.subscribe.confirmTokenExpiryHours * 60 * 60 * 1000)

  // Check if already confirmed
  const existing = await prisma.pendingSubscription.findFirst({
    where: { email, confirmedAt: { not: null } },
  })
  if (existing) {
    log.info({ email }, 'already subscribed, returning success without action')
    return
  }

  // Send limits, before any external call. A throttled address gets the same
  // generic success as a real signup (the route cannot tell them apart), so a bot
  // learns nothing; nothing is written or sent.
  const allowance = await checkSendAllowance(email)
  if (allowance === 'address-limited') {
    log.info({ email }, 'confirmation email already sent within the window, sending nothing')
    return
  }
  if (allowance === 'global-cap') {
    throw new SignupUnavailableError()
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
    const detail = axios.isAxiosError(err)
      ? { status: err.response?.status, plunkResponse: err.response?.data }
      : {}
    log.warn({ err, ...detail, email }, 'email verification failed, skipping check')
  }

  // Delete any existing unconfirmed pending subscriptions for this email.
  // This handles the re-subscribe case: user gets a fresh token and a new
  // confirmation email instead of accumulating stale entries. Only rows older
  // than the per-address window can be here (a newer one stopped us above), so
  // the hourly count in checkSendAllowance is not affected.
  await prisma.pendingSubscription.deleteMany({
    where: { email, confirmedAt: null },
  })

  // Store the pending subscription; its plunkContactId stays null for now.
  // NOTE: sending the confirmation email below DOES create a Plunk contact for
  // this address — Plunk creates a contact for every /v1/send recipient
  // (subscribed:false by default). So unconfirmed signups (including bots that
  // clear the gate) leave an *unsubscribed* Plunk contact behind; the
  // cleanup-plunk-contacts script purges the never-confirmed ones. On confirm,
  // that contact is upserted to subscribed:true.
  const pending = await prisma.pendingSubscription.create({
    data: {
      email,
      token,
      expiresAt,
    },
  })

  // Send confirmation email. The link points at the client confirmation page
  // (not a state-changing GET), so email security scanners that prefetch links
  // cannot auto-confirm — confirmation requires a POST from the page button.
  const confirmUrl = `${config.clientUrl}/subscribed?${new URLSearchParams({ token, email }).toString()}`
  const html = confirmationEmailHtml(confirmUrl)

  try {
    await plunk.sendTransactional({
      to: email,
      subject: 'Confirm your subscription to Actually Relevant',
      body: html,
    })
    log.info({ email }, 'confirmation email sent')
  } catch (err) {
    log.error({ err, email }, 'failed to send confirmation email')
    // A row stands for exactly one sent email (the send limits count rows), so a
    // failed send must not leave one behind.
    await prisma.pendingSubscription.delete({ where: { id: pending.id } }).catch((deleteErr: unknown) => {
      log.error({ err: deleteErr, email }, 'failed to remove the pending row after a failed send')
    })
    throw new ConfirmationEmailError(
      "We couldn't send the confirmation email right now. Please try again in a few minutes.",
    )
  }
}

/**
 * The confirmation email. It repeats nothing the visitor typed except the address
 * it is sent to, inside the confirm link, so a bot cannot use it to carry a message.
 */
function confirmationEmailHtml(confirmUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#fdf2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fdf2f8;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="500" cellpadding="0" cellspacing="0" style="max-width:500px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;border-bottom:3px solid #ec268f;">
              <h1 style="margin:0;font-size:22px;font-weight:800;color:#171717;">Actually Relevant</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;font-size:20px;color:#171717;">Confirm your subscription</h2>
              <p style="margin:0 0 8px;font-size:15px;color:#525252;line-height:1.6;">Hi, click the button below to confirm your subscription.</p>
              <p style="margin:0 0 24px;font-size:14px;color:#737373;line-height:1.5;font-style:italic;">News that matters to humanity. Weekly to your inbox. Curated with care by AI.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:6px;background-color:#d41f7f;">
                    <a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm Subscription</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;color:#a3a3a3;">This link expires in ${config.subscribe.confirmTokenExpiryHours} hours.</p>
              <p style="margin:12px 0 0;font-size:13px;color:#a3a3a3;">You got this email because someone entered this address at actuallyrelevant.news. If it wasn't you, do nothing and you won't hear from us again.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function confirmSubscription(token: string, rawEmail: string) {
  // Links sent before normalization may carry a mixed-case address.
  const email = normalizeEmail(rawEmail)
  const pending = await prisma.pendingSubscription.findFirst({
    where: { token, email },
  })

  if (!pending) {
    throw new Error('Invalid confirmation link')
  }

  if (pending.confirmedAt) {
    return // Already confirmed — idempotent
  }

  if (new Date() > pending.expiresAt) {
    throw new Error('Confirmation link has expired')
  }

  // Upsert the Plunk contact to subscribed:true. The contact already exists —
  // the confirmation email's send created it as unsubscribed — so the
  // create-contact call updates it to subscribed (Plunk upserts on email).
  // Graceful: if Plunk fails, still mark confirmed locally.
  let plunkContactId: string | null = pending.plunkContactId
  try {
    const contact = await plunk.createContact({ email, subscribed: true })
    plunkContactId = contact.id
  } catch (err) {
    log.warn({ err, email }, 'failed to create Plunk contact on confirm, marking confirmed anyway')
  }

  await prisma.pendingSubscription.update({
    where: { id: pending.id },
    data: { confirmedAt: new Date(), plunkContactId },
  })

  log.info({ email }, 'subscription confirmed')
}
