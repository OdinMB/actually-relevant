/**
 * The publish_newsletter cron entry: sends this week's automatic issue (the one generate_newsletter
 * built, keyed by `weekKey`) to all subscribers, which also publishes it, through the lifecycle's
 * `sendLive` move. Seeded disabled, 30 minutes after generate_newsletter. The move refuses an issue
 * already sent (or with an unconfirmed send) and one without a test email of its current HTML, so
 * a retry, a manual Run, a boot catch-up or an editor's click never sends a second email.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { NewsletterRefusedError, sendLive } from '../services/newsletterLifecycle.js'
import { getWeekKey } from './generateNewsletter.js'

const log = createLogger('publish_newsletter')

export const PUBLISH_NEWSLETTER_JOB = 'publish_newsletter'

/** A live send that counts as sent: not a test, not failed (a failed row proves nothing went out). */
const LIVE_SEND = { isTest: false, status: { not: 'failed' } } as const

/** Why the job cannot send, or null when it can (the enable check). */
export function newsletterSendProblem(): string | null {
  return config.plunk.secretKey ? null : 'newsletter sending needs PLUNK_SECRET_KEY'
}

export async function runPublishNewsletter(now: Date = new Date()): Promise<void> {
  const weekKey = getWeekKey(now)
  // Every run that sends nothing records why; a failed send fails the run, which the scheduler alerts.
  const notSent = async (reason: string) => {
    log.warn({ weekKey, reason }, "not sending this week's newsletter")
    await notify({
      source: 'newsletter',
      severity: 'warning',
      title: 'Newsletter not sent',
      message: reason,
      link: '/admin/newsletters',
      dedupeKey: `newsletter-not-sent:${weekKey}`,
    })
  }
  const alreadySent = async (newsletterId: string, title: string) => {
    log.info({ weekKey, newsletterId }, "this week's issue was already sent or published")
    await notify({
      source: 'newsletter',
      severity: 'info',
      title: 'Newsletter already sent',
      message: `${title} (${weekKey}) was already sent or published before publish_newsletter ran, so it sent nothing.`,
      link: '/admin/newsletters',
      dedupeKey: `newsletter-already-sent:${weekKey}`,
    })
  }

  const issue = await prisma.newsletter.findFirst({
    where: { weekKey, html: { not: '' }, status: 'draft', sends: { none: LIVE_SEND } },
    select: { id: true, title: true },
  })
  if (!issue) {
    const existing = await prisma.newsletter.findFirst({
      where: { weekKey },
      select: { id: true, title: true, status: true, sends: { where: LIVE_SEND, select: { status: true } } },
    })
    if (existing?.sends.some(send => send.status === 'draft')) {
      await notSent(
        `A live send of ${existing.title} (${weekKey}) is unconfirmed, so nothing more was sent. Check the campaign in Plunk, then mark the send as not sent on the newsletter page if it did not go out.`,
      )
    } else if (existing && (existing.status === 'published' || existing.sends.length > 0)) {
      await alreadySent(existing.id, existing.title)
    } else if (existing) {
      await notSent(`This week's issue (${weekKey}) was still being built when publish_newsletter ran. Send it from the newsletter page once it is ready.`)
    } else {
      await notSent(`There is no automatic issue for ${weekKey}, so nothing was sent. Check the Generate Newsletter job.`)
    }
    return
  }

  log.info({ weekKey, newsletterId: issue.id }, 'sending newsletter to all subscribers')
  try {
    await sendLive(issue.id)
  } catch (err) {
    if (!(err instanceof NewsletterRefusedError)) throw err
    if (err.code === 'already_sent') return alreadySent(issue.id, issue.title)
    if (err.code === 'no_current_test') {
      return notSent(
        `${issue.title} (${weekKey}) has no successful test email of its current HTML, so it was not sent to subscribers. Send the test, then send it live from the newsletter page.`,
      )
    }
    throw err
  }
  log.info({ weekKey, newsletterId: issue.id }, 'newsletter sent and published')

  await notify({
    source: 'newsletter',
    severity: 'info',
    title: 'Newsletter sent',
    message: `${issue.title} (${weekKey}) was sent to all subscribers and marked published.`,
    link: '/admin/newsletters',
  })
}
