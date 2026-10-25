/**
 * The publish_newsletter cron entry: sends this week's automatic issue (the one generate_newsletter
 * built, keyed by `weekKey`) to all subscribers and marks it published, only once its test email
 * went out. Seeded disabled, 30 minutes after generate_newsletter. An issue already sent live or published by hand is left alone, so a
 * retry, a manual Run or a boot catch-up never sends a second email for the week.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { sendLive, updateNewsletter } from '../services/newsletter.js'
import { getWeekKey } from './generateNewsletter.js'

const log = createLogger('publish_newsletter')

export const PUBLISH_NEWSLETTER_JOB = 'publish_newsletter'

/** Why the job cannot send, or null when it can (the enable check). */
export function newsletterSendProblem(): string | null {
  return config.plunk.secretKey ? null : 'newsletter sending needs PLUNK_SECRET_KEY'
}

export async function runPublishNewsletter(now: Date = new Date()): Promise<void> {
  const weekKey = getWeekKey(now)
  const issue = await prisma.newsletter.findFirst({
    where: {
      weekKey,
      html: { not: '' },
      status: 'draft',
      sends: { none: { isTest: false } },
    },
    select: { id: true, title: true, sends: { where: { isTest: true }, select: { id: true }, take: 1 } },
  })
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

  // sendTest records its row only after Plunk accepted the send, so a row means the test went out.
  if (issue && issue.sends.length === 0) {
    await notSent(
      `${issue.title} (${weekKey}) has no successful test email, so it was not sent to subscribers. Send the test, then send it live from the newsletter page.`,
    )
    return
  }
  if (!issue) {
    const existing = await prisma.newsletter.findFirst({
      where: { weekKey },
      select: { id: true, title: true, status: true, sends: { where: { isTest: false }, select: { id: true }, take: 1 } },
    })
    if (existing && (existing.status === 'published' || existing.sends.length > 0)) {
      log.info({ weekKey, newsletterId: existing.id }, "this week's issue was already sent or published")
      await notify({
        source: 'newsletter',
        severity: 'info',
        title: 'Newsletter already sent',
        message: `${existing.title} (${weekKey}) was already sent or published before publish_newsletter ran, so it sent nothing.`,
        link: '/admin/newsletters',
        dedupeKey: `newsletter-already-sent:${weekKey}`,
      })
    } else if (existing) {
      await notSent(`This week's issue (${weekKey}) was still being built when publish_newsletter ran. Send it from the newsletter page once it is ready.`)
    } else {
      await notSent(`There is no automatic issue for ${weekKey}, so nothing was sent. Check the Generate Newsletter job.`)
    }
    return
  }

  log.info({ weekKey, newsletterId: issue.id }, 'sending newsletter to all subscribers')
  await sendLive(issue.id)
  await updateNewsletter(issue.id, { status: 'published' })
  log.info({ weekKey, newsletterId: issue.id }, 'newsletter sent and published')

  await notify({
    source: 'newsletter',
    severity: 'info',
    title: 'Newsletter sent',
    message: `${issue.title} (${weekKey}) was sent to all subscribers and marked published.`,
    link: '/admin/newsletters',
  })
}
