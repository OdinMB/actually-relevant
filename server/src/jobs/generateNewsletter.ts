import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { type NewsletterEdition, StoryStatus } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import type { NoticeInput } from '../services/adminNotices.js'
import { createNewsletter } from '../services/newsletter.js'
import { upliftingCandidateIds } from '../services/upliftingIssue.js'
import { assignStories, selectStories, generateContent, generateHtml, sendTest, deleteNewsletter } from '../services/newsletterLifecycle.js'

const log = createLogger('generate_newsletter')

export const GENERATE_UPLIFTING_NEWSLETTER_JOB = 'generate_uplifting_newsletter'

const DAY_MS = 24 * 60 * 60 * 1000

/** ISO-8601 week-numbering year and week of the given date's calendar day. */
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/** Compute ISO week number and return title like "Week 7, 2026" */
export function getWeekTitle(date: Date): string {
  const { year, week } = isoWeek(date)
  return `Week ${week}, ${year}`
}

/** ISO week key like "2026-W07": identifies the automatic issue of that week. */
export function getWeekKey(date: Date): string {
  const { year, week } = isoWeek(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Decide whether this week's automatic issue of the edition may be built now. Only rows a weekly job
 * created (weekKey set) of that edition are considered, so neither edition's issue blocks the other's;
 * "built" means the HTML exists. Deletes this week's unbuilt draft when it is old enough to be a
 * killed run.
 */
async function checkWeeklySlot(now: Date, weekKey: string, edition: NewsletterEdition): Promise<'proceed' | 'skip'> {
  const recentSince = new Date(now.getTime() - config.newsletter.minHoursBetweenIssues * 60 * 60 * 1000)
  const built = await prisma.newsletter.findFirst({
    where: {
      edition,
      weekKey: { not: null },
      html: { not: '' },
      OR: [{ weekKey }, { createdAt: { gte: recentSince } }],
    },
    select: { id: true, weekKey: true },
  })
  if (built) {
    log.info({ weekKey, edition, newsletterId: built.id, builtWeekKey: built.weekKey }, 'issue already built this week or too recently, skipping')
    return 'skip'
  }

  const draft = await prisma.newsletter.findFirst({
    where: { edition, weekKey, html: '' },
    select: { id: true, updatedAt: true },
  })
  if (!draft) return 'proceed'

  const ageMs = now.getTime() - draft.updatedAt.getTime()
  if (ageMs < config.newsletter.abandonedDraftMinutes * 60 * 1000) {
    log.info({ weekKey, edition, newsletterId: draft.id }, "this week's issue is being built by another run, skipping")
    return 'skip'
  }

  log.warn({ weekKey, edition, newsletterId: draft.id, ageMs }, 'deleting abandoned unbuilt draft from a killed run')
  await deleteNewsletter(draft.id)
  return 'proceed'
}

/** How many stories this week's issue of the edition could carry: the same lists its assign move reads. */
async function weeklyStoryCount(edition: NewsletterEdition, now: Date): Promise<number> {
  if (edition === 'uplifting') return (await upliftingCandidateIds()).length
  // Must match the query in newsletter.recentStoryIds() to avoid false positives
  return prisma.story.count({
    where: {
      status: StoryStatus.published,
      dateCrawled: { gte: new Date(now.getTime() - config.content.storyAssignmentDays * DAY_MS) },
    },
  })
}

/**
 * The notice of a week whose issue of the edition has no story. For the full edition a warning: a
 * stalled pipeline would otherwise mean a week with no newsletter and no word about it. For Actually
 * Uplifting the designed skip, so `info`: a week without uplifting stories has no issue.
 */
export function noStoriesNotice(edition: NewsletterEdition, weekKey: string): NoticeInput {
  const days = config.content.storyAssignmentDays
  if (edition === 'uplifting') {
    return {
      source: 'newsletter',
      severity: 'info',
      title: 'No Actually Uplifting issue this week',
      message: `0 stories: no published story tagged uplifting was crawled in the last ${days} days that another Actually Uplifting issue does not already carry, so there is no Actually Uplifting issue for ${weekKey}. Nothing needs doing; the edition skips a week without uplifting stories.`,
      link: '/admin/newsletters',
      dedupeKey: `newsletter-uplifting-no-stories:${weekKey}`,
    }
  }
  return {
    source: 'newsletter',
    severity: 'warning',
    title: 'No newsletter this week',
    message: `No published story was crawled in the last ${days} days; check the Jobs page (crawl, assess, publish).`,
    link: '/admin/jobs',
    dedupeKey: `newsletter-no-stories:${weekKey}`,
  }
}

/**
 * This week's automatic issue of the edition: built (assign, select, generate, HTML) and its test
 * email sent to the test segment. One issue per edition and week (`checkWeeklySlot`); a week whose
 * edition has no story builds nothing and records `noStoriesNotice`.
 */
export async function generateWeeklyIssue(edition: NewsletterEdition, now: Date = new Date()): Promise<void> {
  const weekKey = getWeekKey(now)
  // The slot first: Actually Uplifting's count leaves out the stories its built issues carry, so once
  // this week's issue is built a later run would count none and report a week without stories
  if ((await checkWeeklySlot(now, weekKey, edition)) === 'skip') return

  const count = await weeklyStoryCount(edition, now)
  if (count === 0) {
    log.warn({ weekKey, edition }, 'no stories for this week, skipping newsletter generation')
    await notify(noStoriesNotice(edition, weekKey))
    return
  }

  const title = getWeekTitle(now)

  log.info({ title, weekKey, edition, recentStoryCount: count }, 'starting newsletter generation')

  const newsletter = await createNewsletter({ title, edition, weekKey })
  log.info({ newsletterId: newsletter.id }, 'newsletter created')

  try {
    await assignStories(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'stories assigned')

    await selectStories(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'stories selected')

    await generateContent(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'content generated')

    await generateHtml(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'HTML generated')
  } catch (err) {
    log.error({ newsletterId: newsletter.id, err }, 'pipeline failed, cleaning up')
    await deleteNewsletter(newsletter.id).catch(() => {})
    throw err
  }

  // Outside the cleanup: a failed test send keeps the built issue (the admin can
  // resend) and still fails the job so runJob alerts.
  await sendTest(newsletter.id)
  log.info({ newsletterId: newsletter.id }, 'test email sent')
}

/** The generate_newsletter cron entry: the full edition's weekly issue. */
export const runGenerateNewsletter = (): Promise<void> => generateWeeklyIssue('full')

/** The generate_uplifting_newsletter cron entry (seeded disabled): Actually Uplifting's weekly issue. */
export const runGenerateUpliftingNewsletter = (): Promise<void> => generateWeeklyIssue('uplifting')
