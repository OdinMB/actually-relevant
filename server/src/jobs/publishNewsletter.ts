/**
 * The weekly publish cron entries, one per edition: publish_newsletter sends this week's automatic
 * full issue (the one generate_newsletter built, keyed by `weekKey`), publish_uplifting_newsletter
 * this week's Actually Uplifting issue, each to its edition's audience, which also publishes it,
 * through the lifecycle's `sendLive` move. Both seeded disabled, 30 minutes after their generate
 * job. The move refuses an issue already sent (or with an unconfirmed send), one without a test email
 * of its current HTML, and one whose edition has no audience, so a retry, a manual Run, a boot
 * catch-up or an editor's click never sends a second email. Each job looks only at its own
 * edition's issue.
 */
import type { NewsletterEdition } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { NewsletterRefusedError, sendLive } from '../services/newsletterLifecycle.js'
import { upliftingCandidateIds } from '../services/upliftingIssue.js'
import { getWeekKey, noStoriesNotice } from './generateNewsletter.js'

const log = createLogger('publish_newsletter')

export const PUBLISH_NEWSLETTER_JOB = 'publish_newsletter'
export const PUBLISH_UPLIFTING_NEWSLETTER_JOB = 'publish_uplifting_newsletter'

/** A live send that counts as sent: not a test, not failed (a failed row proves nothing went out). */
const LIVE_SEND = { isTest: false, status: { not: 'failed' } } as const

/** Why the job cannot send, or null when it can (the enable check). */
export function newsletterSendProblem(): string | null {
  return config.plunk.secretKey ? null : 'newsletter sending needs PLUNK_SECRET_KEY'
}

/** Why an Actually Uplifting job may not be enabled: the editions are closed, so its issue has no audience. */
export function upliftingEditionProblem(): string | null {
  return config.newsletter.editionsOpen
    ? null
    : 'Actually Uplifting needs the editions open: set PLUNK_FULL_EDITION_SEGMENT_ID and PLUNK_UPLIFTING_SEGMENT_ID (.context/newsletter-podcast.md, "Editions")'
}

/** What the notices of one edition's publish run say and are keyed by; the full edition's are as before the editions. */
const NOTICES: Record<NewsletterEdition, { what: string; keyPrefix: string; job: string; generateJob: string }> = {
  full: { what: 'Newsletter', keyPrefix: 'newsletter', job: PUBLISH_NEWSLETTER_JOB, generateJob: 'Generate Newsletter' },
  uplifting: {
    what: 'Actually Uplifting issue',
    keyPrefix: 'newsletter-uplifting',
    job: PUBLISH_UPLIFTING_NEWSLETTER_JOB,
    generateJob: 'Generate Actually Uplifting Newsletter',
  },
}

/** Whom a sent issue of the edition reached, in the notice's words. */
function audienceWords(edition: NewsletterEdition): string {
  if (edition === 'uplifting') return "Actually Uplifting's subscribers"
  return config.newsletter.editionsOpen ? "the full edition's subscribers" : 'all subscribers'
}

/** Sends this week's automatic issue of the edition, and leaves a notice of what it did. */
export async function publishWeeklyIssue(edition: NewsletterEdition, now: Date = new Date()): Promise<void> {
  const weekKey = getWeekKey(now)
  const { what, keyPrefix, job, generateJob } = NOTICES[edition]
  // Every run that sends nothing records why; a failed send fails the run, which the scheduler alerts.
  const notSent = async (reason: string) => {
    log.warn({ weekKey, edition, reason }, "not sending this week's newsletter")
    await notify({
      source: 'newsletter',
      severity: 'warning',
      title: `${what} not sent`,
      message: reason,
      link: '/admin/newsletters',
      dedupeKey: `${keyPrefix}-not-sent:${weekKey}`,
    })
  }
  const alreadySent = async (newsletterId: string, title: string) => {
    log.info({ weekKey, edition, newsletterId }, "this week's issue was already sent or published")
    await notify({
      source: 'newsletter',
      severity: 'info',
      title: `${what} already sent`,
      message: `${title} (${weekKey}) was already sent or published before ${job} ran, so it sent nothing.`,
      link: '/admin/newsletters',
      dedupeKey: `${keyPrefix}-already-sent:${weekKey}`,
    })
  }

  const issue = await prisma.newsletter.findFirst({
    where: { edition, weekKey, html: { not: '' }, status: 'draft', sends: { none: LIVE_SEND } },
    select: { id: true, title: true },
  })
  if (!issue) {
    const existing = await prisma.newsletter.findFirst({
      where: { edition, weekKey },
      select: { id: true, title: true, status: true, sends: { where: LIVE_SEND, select: { status: true } } },
    })
    if (existing?.sends.some(send => send.status === 'draft')) {
      await notSent(
        `A live send of ${existing.title} (${weekKey}) is unconfirmed, so nothing more was sent. Check the campaign in Plunk, then mark the send as not sent on the newsletter page if it did not go out.`,
      )
    } else if (existing && (existing.status === 'published' || existing.sends.length > 0)) {
      await alreadySent(existing.id, existing.title)
    } else if (existing) {
      await notSent(`This week's issue (${weekKey}) was still being built when ${job} ran. Send it from the newsletter page once it is ready.`)
    } else if (edition === 'uplifting' && (await upliftingCandidateIds()).length === 0) {
      // The designed skip of a week without uplifting stories: the generate job's notice, seen again
      await notify(noStoriesNotice(edition, weekKey))
    } else {
      await notSent(`There is no automatic issue for ${weekKey}, so nothing was sent. Check the ${generateJob} job.`)
    }
    return
  }

  log.info({ weekKey, edition, newsletterId: issue.id }, "sending newsletter to its edition's subscribers")
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
    if (err.code === 'no_audience') return notSent(`${issue.title} (${weekKey}): ${err.message}`)
    throw err
  }
  log.info({ weekKey, edition, newsletterId: issue.id }, 'newsletter sent and published')

  await notify({
    source: 'newsletter',
    severity: 'info',
    title: `${what} sent`,
    message: `${issue.title} (${weekKey}) was sent to ${audienceWords(edition)} and marked published.`,
    link: '/admin/newsletters',
  })
}

/** The publish_newsletter cron entry: the full edition. */
export const runPublishNewsletter = (now: Date = new Date()): Promise<void> => publishWeeklyIssue('full', now)

/** The publish_uplifting_newsletter cron entry (seeded disabled): Actually Uplifting. */
export const runPublishUpliftingNewsletter = (now: Date = new Date()): Promise<void> => publishWeeklyIssue('uplifting', now)
