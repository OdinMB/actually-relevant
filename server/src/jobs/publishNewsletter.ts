/**
 * The publish_newsletter cron entry: sends this week's automatic issue (the one generate_newsletter
 * built, keyed by `weekKey`) to all subscribers and marks it published. Seeded disabled, 30 minutes
 * after generate_newsletter. An issue already sent live or published by hand is left alone, so a
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
    select: { id: true, title: true },
  })
  if (!issue) {
    // No issue at all was already alerted by generate_newsletter (no stories, or its failure);
    // one still being built would otherwise be missed without a word.
    const unbuilt = await prisma.newsletter.findFirst({ where: { weekKey, html: '' }, select: { id: true } })
    if (unbuilt) {
      log.warn({ weekKey, newsletterId: unbuilt.id }, 'this week\'s issue is not built yet, not sending')
      await notify({
        source: 'newsletter',
        severity: 'warning',
        title: 'Newsletter not sent',
        message: `This week's issue (${weekKey}) was still being built when publish_newsletter ran. Send it from the newsletter page once it is ready.`,
        link: '/admin/newsletters',
        dedupeKey: `newsletter-not-sent:${weekKey}`,
      })
      return
    }
    log.info({ weekKey }, 'no built, unsent issue this week, nothing to publish')
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
