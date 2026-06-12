import { randomUUID } from 'crypto'
import axios from 'axios'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import * as plunk from './plunk.js'
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

/**
 * Strip URLs and markup from a submitted first name. Subscription-bombing
 * campaigns put attacker URLs in the name so the confirmation email looks like
 * their ad; this neutralizes that and keeps the greeting plain text.
 */
export function sanitizeFirstName(name: string): string {
  return name
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/www\.\S+/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

interface SubscribeParams {
  email: string
  firstName?: string
}

export async function subscribe({ email, firstName }: SubscribeParams) {
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

  // Email validation via Plunk. Best-effort: if the verify API errors (e.g. it is
  // unavailable or returns 403), log and proceed rather than blocking signups —
  // the honeypot + form-token gate above already stops bots, and double opt-in is
  // the backstop. Only an explicit validation failure (bad/disposable address)
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

  const cleanFirstName = firstName ? sanitizeFirstName(firstName) : ''

  // Delete any existing unconfirmed pending subscriptions for this email.
  // This handles the re-subscribe case: user gets a fresh token and a new
  // confirmation email instead of accumulating stale entries.
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
  await prisma.pendingSubscription.create({
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
  const greeting = cleanFirstName ? `Hi ${cleanFirstName},` : 'Hi,'

  const html = `<!DOCTYPE html>
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
              <p style="margin:0 0 8px;font-size:15px;color:#525252;line-height:1.6;">${greeting} Click the button below to confirm your subscription.</p>
              <p style="margin:0 0 24px;font-size:14px;color:#737373;line-height:1.5;font-style:italic;">News that matters to humanity. Weekly to your inbox. Curated with care by AI.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:6px;background-color:#d41f7f;">
                    <a href="${confirmUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm Subscription</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;color:#a3a3a3;">This link expires in ${config.subscribe.confirmTokenExpiryHours} hours. If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  try {
    await plunk.sendTransactional({
      to: email,
      subject: 'Confirm your subscription to Actually Relevant',
      body: html,
    })
    log.info({ email }, 'confirmation email sent')
  } catch (err) {
    log.error({ err, email }, 'failed to send confirmation email')
    throw new ConfirmationEmailError(
      "We couldn't send the confirmation email right now. Please try again in a few minutes.",
    )
  }
}

export async function confirmSubscription(token: string, email: string) {
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
