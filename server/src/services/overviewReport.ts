/**
 * A reader's "Report an error" from an overview page (`.context/overviews.md`, "Reviews"): null when
 * no public overview with a shown entry has this id; otherwise whether the report queues the
 * overview's review (`reportQueuesReview`: unless another report queued one within
 * `reportReviewEveryDays`; later reports are stored and queue nothing). The job's review reads the
 * queued one (`overviewStates`, `reportAt`). SELECT only.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { PUBLIC_OVERVIEW, SHOWN_ENTRY } from './overviewPublicRule.js'
import { overviewStepOn } from './overviewQueue.js'
import { reportQueuesReview } from './overviewStatus.js'

export async function overviewReport(
  id: string,
  now = new Date(),
  options: Pick<typeof config.overviews, 'reportReviewEveryDays'> = config.overviews,
): Promise<{ queuesReview: boolean } | null> {
  if (!(await overviewStepOn())) return null
  const o = await prisma.overview.findFirst({ where: { ...PUBLIC_OVERVIEW, id, entries: { some: SHOWN_ENTRY } }, select: { id: true } })
  if (!o) return null
  const last = await prisma.feedback.findFirst({ where: { overviewId: o.id, queuesReview: true }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  return { queuesReview: reportQueuesReview(last?.createdAt ?? null, now, options) }
}
