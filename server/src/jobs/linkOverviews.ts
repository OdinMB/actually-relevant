/**
 * The overview step, the `link_overviews` job (`.context/overviews.md`, "The job"), the daily
 * edition's step after publishing: it links each published story it still owes a link decision
 * (`overviewQueue.ts`), the backlog's slice (the backfill, at most `backfillPerRun`) first and then
 * the night's (at most `perRun`), each oldest first; link calls `concurrency` at a time, every write
 * one story at a time in that order (`linkInOrder`, `applyLink`). It runs only while its gate and
 * research passes' gate are open and its job is enabled, re-reading that before each write, so a run
 * by hand of the disabled job does nothing. A story is settled by its `link` decision, so a run a
 * restart cut off resumes where it stopped. Then the upkeep (`overviewUpkeep.ts`): the end-event
 * closing checks, the status machine in development time (`upkeepClock`), the reviews due and the
 * monthly audit, the stands refreshes due. Stories and overviews that fail go on to the next run; a
 * failure of the job as a whole never stops its chain (`GOES_ON_PAST_FAILURE`). The item tally (joins
 * proposed and stands lines checked; the yeses code refused and the lines dropped) goes into the run's
 * usage (`recordItems`) for the failure-share notice.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { notify } from '../lib/notify.js'
import { sanitizedError } from '../lib/runErrors.js'
import { countOf, recordItems, reportRunResult } from '../lib/runUsage.js'
import { utcDay } from '../lib/days.js'
import { buildFactCheckPromptParts } from '../prompts/research.js'
import {
  buildCloseCheckPrompt,
  buildClosePrompt,
  buildFoundCheckPrompt,
  buildFoundPrompt,
  buildLinkPromptParts,
  buildReviewPrompt,
  buildStandsPromptParts,
} from '../prompts/overviews.js'
import { closeCheckSchema, closeSchema, foundCheckSchema, foundSchema, linkSchema, reviewSchema, standsSchema } from '../schemas/overviews.js'
import { factCheckSchema } from '../schemas/research.js'
import { membershipsOf, nearestPublished } from '../services/overviewCandidates.js'
import { candidateOverviews, linkStories } from '../services/overviewInput.js'
import { applyAudit, applyBurst, applyClosing, applyLink, applyReview, applyStands, applyStatus } from '../services/overviewLifecycle.js'
import { linkInOrder, type ApplyLink, type LinkDeps } from '../services/overviewLink.js'
import { LINK_OVERVIEWS_JOB, overviewStepOn, overviewSwitchRefusal, owedStories } from '../services/overviewQueue.js'
import type { LinkOutcome, LinkStory } from '../services/overviewTypes.js'
import { runUpkeep, type UpkeepDeps, type UpkeepTally } from '../services/overviewUpkeep.js'
import { auditPicks, overviewStates, pendingClosings, reviewCase, standsCases } from '../services/overviewUpkeepInput.js'
import { structuredCall } from '../services/structuredCall.js'
import { jobDisplayName } from './jobDisplayName.js'

export { LINK_OVERVIEWS_JOB }

const log = createLogger(LINK_OVERVIEWS_JOB)

/** Why the step does nothing while its gates are open: its job is disabled. */
export const OVERVIEW_JOB_DISABLED = 'Overviews are switched off: the link_overviews job is disabled on the Jobs page'

/** Linking as production runs it: the tables, read as they stand at each step, and the models at the step's tiers. */
export const productionLinkDeps = (): LinkDeps => {
  const { tiers } = config.overviews
  return {
    neighbours: story => nearestPublished(prisma, story.id, story.datePublished),
    memberships: (ids, asOf) => membershipsOf(prisma, ids, asOf),
    overviews: (ids, asOf) => candidateOverviews(prisma, ids, asOf),
    stories: ids => linkStories(prisma, ids),
    link: input => structuredCall(tiers.link, linkSchema, buildLinkPromptParts(input)),
    found: input => structuredCall(tiers.found, foundSchema, buildFoundPrompt(input)),
    foundCheck: input => structuredCall(tiers.foundCheck, foundCheckSchema, buildFoundCheckPrompt(input)),
  }
}

/** The upkeep as production runs it: the tables, the lifecycle's writes, and the models at the step's tiers (the audit at high effort). */
export const productionUpkeepDeps = (now: Date): UpkeepDeps => {
  const { tiers } = config.overviews
  return {
    closings: () => pendingClosings(prisma),
    states: () => overviewStates(prisma, now),
    reviewCase: id => reviewCase(prisma, id),
    auditPicks: at => auditPicks(prisma, at),
    standsCases: () => standsCases(prisma),
    close: {
      close: input => structuredCall(tiers.close, closeSchema, buildClosePrompt(input)),
      closeCheck: input => structuredCall(tiers.closeCheck, closeCheckSchema, buildCloseCheckPrompt(input)),
    },
    review: { review: (input, { audit }) => structuredCall(tiers.review, reviewSchema, buildReviewPrompt(input), audit ? { effort: 'high' } : {}) },
    stands: {
      write: input => structuredCall(tiers.stands, standsSchema, buildStandsPromptParts(input)),
      check: (items, lines) => structuredCall(tiers.standsCheck, factCheckSchema, buildFactCheckPromptParts(items, lines, [])),
    },
    applyClosing: (c, result) => applyClosing(c, result),
    applyStatus: (state, moves, clock) => applyStatus(state, moves, clock),
    applyBurst: state => applyBurst(state),
    applyReview: (c, result, at) => applyReview(c, result, at),
    applyAudit: (c, result) => applyAudit(c, result),
    applyStands: (c, result, signature, today) => applyStands(c, result, signature, today),
  }
}

/**
 * The development time the status machine counts in (`.context/overviews.md`, "The job"): while a
 * backfill drains (older owed stories left after this run's slice), the newest story this run linked,
 * so an overview formed from May's stories does not fade in November before its later stories join;
 * otherwise now.
 */
export function upkeepClock(slices: { backlog: string[]; backlogTotal: number }, linked: readonly LinkStory[], now: Date): Date {
  if (slices.backlogTotal <= slices.backlog.length || linked.length === 0) return now
  return new Date(Math.max(...linked.map(s => s.datePublished.getTime())))
}

/** "; 3 overviews refreshed, 1 reviewed", and what else the upkeep did when it did it. */
export function upkeepSummary(t: UpkeepTally): string {
  const parts = [`${countOf(t.standsWritten, 'overview', 'overviews')} refreshed`, `${t.reviews.toLocaleString('en-US')} reviewed`]
  if (t.closingsBegun > 0) parts.push(`${t.closingsBegun.toLocaleString('en-US')} closing`)
  if (t.bursts > 0) parts.push(`${t.bursts.toLocaleString('en-US')} frozen by a burst`)
  if (t.audits > 0) parts.push(`${t.audits.toLocaleString('en-US')} audited`)
  if (t.failed > 0) parts.push(`${t.failed.toLocaleString('en-US')} upkeep ${t.failed === 1 ? 'item' : 'items'} failed`)
  return parts.join(', ')
}

/** Whether the technical failures pass the failure share: more than `share` of at least `failedStoriesMin` stories. */
const storiesFailing = (taken: number, failed: number) => taken >= config.overviews.failedStoriesMin && failed / taken > config.jobs.failureShare.share

async function notifyFailedStories(taken: number, failed: number): Promise<void> {
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: `${jobDisplayName(LINK_OVERVIEWS_JOB)}: ${failed.toLocaleString('en-US')} of ${countOf(taken, 'story', 'stories')} failed in the last run`,
    message:
      'A technical problem stopped their linking: the AI service did not answer, or an error of ours. ' +
      'Nothing paused, and published stories are untouched. They are tried again at the next run. ' +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `stories-failing:${LINK_OVERVIEWS_JOB}`,
  })
}

/** "Linked 9 stories: 4 joined, 1 founded, 4 alone", with the outcomes that leave a story owed after it. */
export function linkSummary(outcomes: ReadonlyMap<string, LinkOutcome>, backlog: { taken: number; total: number } | null): string {
  const n = (...wanted: LinkOutcome[]) => [...outcomes.values()].filter(o => wanted.includes(o)).length
  const optional = (count: number, words: string) => (count > 0 ? `, ${count.toLocaleString('en-US')} ${words}` : '')
  const line =
    `Linked ${countOf(outcomes.size, 'story', 'stories')}: ${n('joined')} joined, ${n('founded')} founded, ${n('none', 'rejected')} alone` +
    optional(n('held'), 'held by a frozen overview') +
    optional(n('conflict'), 'left for the next run') +
    optional(n('failed'), 'failed')
  return backlog ? `${line}; backfill ${backlog.taken.toLocaleString('en-US')} of ${backlog.total.toLocaleString('en-US')}` : line
}

export async function runLinkOverviewsJob(now: Date = new Date()): Promise<void> {
  const refusal = overviewSwitchRefusal()
  if (refusal || !(await overviewStepOn())) {
    const why = refusal ?? OVERVIEW_JOB_DISABLED
    log.info({ why }, 'overviews are off; nothing linked')
    reportRunResult(`${why}; nothing linked`)
    return
  }

  const slices = await owedStories(now)
  const stories = await linkStories(prisma, [...slices.backlog, ...slices.night])
  log.info({ backlog: slices.backlog.length, night: slices.night.length, backlogTotal: slices.backlogTotal }, 'starting overview linking')
  let switchedOff = false
  // A write that throws is rolled back: the story stays owed and the run goes on
  const apply: ApplyLink = (result, lastTry) =>
    applyLink(result, lastTry).catch((err: unknown) => {
      log.error({ storyId: result.story.id, error: sanitizedError(err) }, 'writing the linking of a story failed; it is tried again next run')
      return { kind: 'written', outcome: 'failed' } as const
    })
  const keepGoing = async () => {
    if (!switchedOff && !(await overviewStepOn())) {
      log.info('overview step switched off; writing nothing else')
      switchedOff = true
    }
    return !switchedOff
  }
  const run = await linkInOrder(stories, productionLinkDeps(), apply, { concurrency: config.overviews.concurrency, keepGoing })

  const proposed = run.results.reduce((sum, r) => sum + r.proposed, 0)
  const refused = run.results.reduce((sum, r) => sum + r.refusals.length, 0)
  const failed = [...run.outcomes.values()].filter(o => o === 'failed').length
  for (const r of run.results)
    if (r.error) log.error({ storyId: r.story.id, error: sanitizedError(r.error) }, 'linking a story failed; it is tried again next run')
  log.info({ stories: run.outcomes.size, proposed, refused, failed }, 'overview linking finished')

  // Parts 2 to 5: closings, the status machine, reviews and the audit, the stands (nothing once switched off)
  let upkeep: UpkeepTally | null = null
  if (!switchedOff) {
    const clock = upkeepClock(
      slices,
      stories.filter(s => run.outcomes.has(s.id)),
      now,
    )
    upkeep = await runUpkeep(productionUpkeepDeps(now), { clock, now, today: utcDay(now) }, keepGoing)
    for (const e of upkeep.errors)
      log.error({ part: e.part, overviewId: e.id, error: sanitizedError(e.error) }, 'overview upkeep failed for an overview; it is tried again next run')
    log.info({ ...upkeep, errors: upkeep.errors.length, clock }, 'overview upkeep finished')
  }
  // Checked: joins proposed and stands lines checked; failed: yeses code refused and stands lines dropped
  recordItems(proposed + (upkeep?.standsChecked ?? 0), refused + (upkeep?.standsDropped ?? 0))
  if (storiesFailing(run.outcomes.size, failed)) await notifyFailedStories(run.outcomes.size, failed).catch(() => {})
  const left = stories.length - run.outcomes.size
  const linked =
    stories.length === 0
      ? 'Nothing to link'
      : linkSummary(run.outcomes, slices.backlogTotal > 0 ? { taken: slices.backlog.length, total: slices.backlogTotal } : null)
  const summary = upkeep ? `${linked}; ${upkeepSummary(upkeep)}` : linked
  reportRunResult(left > 0 && switchedOff ? `${summary}; ${left} left for the next run` : summary)
}
