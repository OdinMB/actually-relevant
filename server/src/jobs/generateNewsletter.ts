import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { StoryStatus } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import {
  createNewsletter,
  assignStories,
  selectStoriesForNewsletter,
  generateContent,
  generateHtmlContent,
  sendTest,
} from '../services/newsletter.js'

const log = createLogger('generate_newsletter')

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
 * Decide whether this week's automatic issue may be built now. Only rows the job
 * created (weekKey set) are considered; "built" means the HTML exists.
 * Deletes this week's unbuilt draft when it is old enough to be a killed run.
 */
async function checkWeeklySlot(now: Date, weekKey: string): Promise<'proceed' | 'skip'> {
  const recentSince = new Date(now.getTime() - config.newsletter.minHoursBetweenIssues * 60 * 60 * 1000)
  const built = await prisma.newsletter.findFirst({
    where: {
      weekKey: { not: null },
      html: { not: '' },
      OR: [{ weekKey }, { createdAt: { gte: recentSince } }],
    },
    select: { id: true, weekKey: true },
  })
  if (built) {
    log.info({ weekKey, newsletterId: built.id, builtWeekKey: built.weekKey }, 'issue already built this week or too recently, skipping')
    return 'skip'
  }

  const draft = await prisma.newsletter.findFirst({
    where: { weekKey, html: '' },
    select: { id: true, updatedAt: true },
  })
  if (!draft) return 'proceed'

  const ageMs = now.getTime() - draft.updatedAt.getTime()
  if (ageMs < config.newsletter.abandonedDraftMinutes * 60 * 1000) {
    log.info({ weekKey, newsletterId: draft.id }, 'this week\'s issue is being built by another run, skipping')
    return 'skip'
  }

  log.warn({ weekKey, newsletterId: draft.id, ageMs }, 'deleting abandoned unbuilt draft from a killed run')
  await prisma.newsletter.delete({ where: { id: draft.id } })
  return 'proceed'
}

export async function runGenerateNewsletter(): Promise<void> {
  const now = new Date()
  const weekKey = getWeekKey(now)
  const days = config.content.storyAssignmentDays
  // Must match the query in newsletter.assignStories() to avoid false positives
  const count = await prisma.story.count({
    where: {
      status: StoryStatus.published,
      dateCrawled: { gte: new Date(now.getTime() - days * DAY_MS) },
    },
  })

  if (count === 0) {
    log.warn({ weekKey }, 'no recent published stories, skipping newsletter generation')
    // A stalled pipeline would otherwise mean a week with no newsletter and no word about it.
    await notify({
      source: 'newsletter',
      severity: 'warning',
      title: 'No newsletter this week',
      message: `No published story was crawled in the last ${days} days; check the Jobs page (crawl, assess, publish).`,
      link: '/admin/jobs',
      dedupeKey: `newsletter-no-stories:${weekKey}`,
    })
    return
  }

  const title = getWeekTitle(now)

  if (await checkWeeklySlot(now, weekKey) === 'skip') return

  log.info({ title, weekKey, recentStoryCount: count }, 'starting newsletter generation')

  const newsletter = await createNewsletter({ title, weekKey })
  log.info({ newsletterId: newsletter.id }, 'newsletter created')

  try {
    await assignStories(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'stories assigned')

    await selectStoriesForNewsletter(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'stories selected')

    await generateContent(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'content generated')

    await generateHtmlContent(newsletter.id)
    log.info({ newsletterId: newsletter.id }, 'HTML generated')
  } catch (err) {
    log.error({ newsletterId: newsletter.id, err }, 'pipeline failed, cleaning up')
    await prisma.newsletter.delete({ where: { id: newsletter.id } }).catch(() => {})
    throw err
  }

  // Outside the cleanup: a failed test send keeps the built issue (the admin can
  // resend) and still fails the job so runJob alerts.
  await sendTest(newsletter.id)
  log.info({ newsletterId: newsletter.id }, 'test email sent')
}
