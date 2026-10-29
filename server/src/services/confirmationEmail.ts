/**
 * The double opt-in confirmation email: its link, how long the link lives, its content and its
 * send. Used by a signup sent at once (`subscribe()`) and by the send_queued_confirmations job.
 */
import { config } from '../config.js'
import * as plunk from './plunk.js'

const HOUR_MS = 60 * 60 * 1000

/** When a confirmation link sent at `from` stops working; a waiting signup expires on the same clock. */
export function confirmationLinkExpiry(from: Date): Date {
  return new Date(from.getTime() + config.subscribe.confirmTokenExpiryHours * HOUR_MS)
}

/**
 * Send the confirmation email for one pending row. The link points at the client confirmation page
 * (not a state-changing GET), so email security scanners that prefetch links cannot auto-confirm:
 * confirmation requires a POST from the page button. Throws Plunk's error when the send fails.
 */
export async function sendConfirmationEmail(email: string, token: string): Promise<void> {
  const confirmUrl = `${config.clientUrl}/subscribed?${new URLSearchParams({ token, email }).toString()}`
  await plunk.sendTransactional({
    to: email,
    subject: 'Confirm your subscription to Actually Relevant',
    body: confirmationEmailHtml(confirmUrl),
  })
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
