/**
 * The overview step, the `link_overviews` job (`.context/overviews.md`, "The job"), the daily
 * edition's step after publishing: it links each published story it still owes a link decision
 * (`overviewQueue.ts`, `overviewOwed.ts`), the backlog's slice (the backfill, at most
 * `backfillPerRun`) first, then the stories due again in the room it leaves (a held story once its
 * overview's freeze lifts; a failed or conflicting one after 1, 3 and 7 days, then given up), then the
 * night's (at most `perRun`), each oldest first; link calls `concurrency` at a time, every write
 * one story at a time in that order (`linkInOrder`, `applyLink`). It runs only while its gate and
 * research passes' gate are open and its job is enabled, re-reading that before each write, so a run
 * by hand of the disabled job does nothing. A story is settled by its `link` decision, so a run a
 * restart cut off resumes where it stopped. Then the upkeep (`overviewUpkeep.ts`): the end-event
 * closing checks, the status machine in development time (`upkeepClock`), the reviews due and the
 * monthly audit, the stands refreshes due. Stories and overviews that fail go on to the next run; a
 * failure of the job as a whole never stops its chain (`GOES_ON_PAST_FAILURE`). The item tally (joins
 * proposed and stands lines written; the yeses code refused and the lines dropped) goes into the run's
 * usage (`recordItems`) for the failure-share notice.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { notify } from '../lib/notify.js'
import { sanitizedError } from '../lib/runErrors.js'
import { countOf, recordItems, reportRunResult } from '../lib/runUsage.js'
import { utcDay } from '../lib/days.js'
import { membershipsOf, nearestPublished } from '../services/overviewCandidates.js'
import { candidateOverviews, linkStories } from '../services/overviewInput.js'
import { applyAudit, applyBurst, applyClosing, applyLink, applyRecenter, applyReview, applyStands, applyStatus } from '../services/overviewLifecycle.js'
import { linkInOrder, type ApplyLink, type LinkDeps } from '../services/overviewLink.js'
import { LINK_OVERVIEWS_JOB, overviewStepOn, overviewSwitchRefusal, owedStories } from '../services/overviewQueue.js'
import { overviewCalls, type OverviewCalls } from '../services/overviewSteps.js'
import type { LinkOutcome, LinkStory } from '../services/overviewTypes.js'
import { recenterCases } from '../services/overviewRecenterInput.js'
import { runUpkeep, type UpkeepDeps, type UpkeepFreeze, type UpkeepRecenter, type UpkeepTally } from '../services/overviewUpkeep.js'
import { auditPicks, overviewStates, pendingClosings, reviewCase, standsCases } from '../services/overviewUpkeepInput.js'
import { structuredCall } from '../services/structuredCall.js'
import { jobDisplayName } from './jobDisplayName.js'

export { LINK_OVERVIEWS_JOB }

const log = createLogger(LINK_OVERVIEWS_JOB)

/** Why the step does nothing while its gates are open: its job is disabled. */
export const OVERVIEW_JOB_DISABLED = 'Overviews are switched off: the link_overviews job is disabled on the Jobs page'

/** The step's model calls as production makes them: `structuredCall` at each step's tier and effort (`overviewSteps.ts`). */
export const productionCalls = (): OverviewCalls =>
  overviewCalls((step, prompt) => structuredCall(step.tier, step.schema, prompt, step.effort ? { effort: step.effort } : {}))

/** Linking as production runs it: the tables, read as they stand at each step, and the step's calls. */
export const productionLinkDeps = (calls: OverviewCalls = productionCalls()): LinkDeps => ({
  neighbours: story => nearestPublished(prisma, story.id, story.datePublished),
  memberships: (ids, asOf) => membershipsOf(prisma, ids, asOf),
  overviews: (ids, asOf) => candidateOverviews(prisma, ids, asOf),
  stories: ids => linkStories(prisma, ids),
  ...calls.link,
})

/** The upkeep as production runs it: the tables, the lifecycle's writes, and the step's calls (the audit at high effort). */
export const productionUpkeepDeps = (now: Date, calls: OverviewCalls = productionCalls()): UpkeepDeps => ({
  closings: () => pendingClosings(prisma),
  states: () => overviewStates(prisma, now),
  reviewCase: id => reviewCase(prisma, id),
  auditPicks: at => auditPicks(prisma, at),
  standsCases: today => standsCases(prisma, today),
  recenterCases: at => recenterCases(prisma, at),
  close: calls.close,
  review: calls.review,
  stands: calls.stands,
  recenter: calls.recenter,
  applyClosing: (c, result) => applyClosing(c, result, now),
  applyStatus: (state, moves, clock) => applyStatus(state, moves, clock, now),
  applyBurst: state => applyBurst(state, now),
  applyRecenter: (c, result) => applyRecenter(c, result, now),
  applyReview: (c, result) => applyReview(c, result, now),
  applyAudit: (c, result) => applyAudit(c, result, now),
  applyStands: (c, result, record, today) => applyStands(c, result, record, today),
})

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
  if (t.recenters.length > 0) parts.push(`${t.recenters.length.toLocaleString('en-US')} re-centered`)
  if (t.closingsBegun > 0) parts.push(`${t.closingsBegun.toLocaleString('en-US')} closing`)
  if (t.bursts > 0) parts.push(`${t.bursts.toLocaleString('en-US')} frozen by a burst`)
  if (t.audits > 0) parts.push(`${t.audits.toLocaleString('en-US')} audited`)
  if (t.failed > 0) parts.push(`${t.failed.toLocaleString('en-US')} upkeep ${t.failed === 1 ? 'item' : 'items'} failed`)
  return parts.join(', ')
}

/** Whether the technical failures pass the failure share: more than `share` of at least `failedStoriesMin` stories (or upkeep items). */
const failing = (taken: number, failed: number) => taken >= config.overviews.failedStoriesMin && failed / taken > config.jobs.failureShare.share

/** The owner's notice of an overview frozen this run: by a burst, whose review in the same run may have cleared it, or by the detach brake, for an editor. */
export async function notifyFreeze(f: UpkeepFreeze): Promise<void> {
  const burst = f.cause === 'burst'
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: burst
      ? `Ongoing story frozen: ${f.count.toLocaleString('en-US')} stories joined "${f.title}" in a day`
      : `Ongoing story frozen: a review of "${f.title}" asked to detach ${countOf(f.count, 'story', 'stories')}`,
    message: burst
      ? 'More stories joined it in one night than the burst limit allows, so it was frozen and its review checks every story (at the next run again if the AI service did not answer). ' +
        'A review that finds they all belong unfreezes it; otherwise it stays frozen, and nothing joins or changes it, until an editor unfreezes it. ' +
        'Check its stories and its decision log on its admin page.'
      : 'The review asked to detach more than half of its entries, so none was detached and the overview is frozen for an editor. ' +
        'Check its stories on its admin page, detach any that do not belong, then unfreeze it.',
    link: `/admin/overviews/${f.overviewId}`,
    dedupeKey: `overview-frozen:${f.overviewId}`,
  })
}

/**
 * The owner's notice of an automated re-center applied this run: it changes what readers see with no
 * person, so the owner reads it (old and new title, and where the limit stands).
 */
export async function notifyRecenter(r: UpkeepRecenter): Promise<void> {
  const limit = config.overviews.maxAutomatedRecenters
  await notify({
    source: 'jobs',
    severity: 'info',
    title: `Ongoing story re-centered: "${r.from}" is now "${r.to}"`,
    message:
      `Two AI checks agreed that its stories now point past its charter, so its charter and title were widened and the stories they agreed on joined. ` +
      `Automatic re-centers: ${r.count.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')}${r.count >= limit ? ': only an editor can re-center it now' : ''}. ` +
      'Check the new charter and its stories on its admin page; Undo puts the old charter back and keeps automation from re-centering it for a while.',
    link: `/admin/overviews/${r.overviewId}`,
    dedupeKey: `overview-recentered:${r.overviewId}`,
  })
}

async function notifyFailedUpkeep(items: number, failed: number): Promise<void> {
  await notify({
    source: 'jobs',
    severity: 'warning',
    title: `${jobDisplayName(LINK_OVERVIEWS_JOB)}: ${failed.toLocaleString('en-US')} of ${countOf(items, 'upkeep item', 'upkeep items')} failed in the last run`,
    message:
      'A technical problem stopped end-event checks, status moves, reviews or "Where this stands" refreshes: the AI service did not answer, or an error of ours. ' +
      'Nothing paused, and the overviews keep what they had. They are tried again at the next run. ' +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `upkeep-failing:${LINK_OVERVIEWS_JOB}`,
  })
}

/**
 * The owner's notice of stories whose linking failed: past the failure share, or whenever a story was
 * given up (its last retry failed or conflicted too), which nothing links again by itself.
 */
export async function notifyFailedStories(taken: number, failed: number, givenUp: number): Promise<void> {
  const days = config.overviews.retryAfterDays
  const last = countOf(days.at(-1) ?? 0, 'day', 'days')
  const retry = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${last}` : last
  await notify({
    source: 'jobs',
    severity: 'warning',
    title:
      `${jobDisplayName(LINK_OVERVIEWS_JOB)}: ${failed.toLocaleString('en-US')} of ${countOf(taken, 'story', 'stories')} failed in the last run` +
      (givenUp > 0 ? `, ${givenUp.toLocaleString('en-US')} given up` : ''),
    message:
      'A technical problem stopped their linking: the AI service did not answer, a write conflicted, or an error of ours. ' +
      `Nothing paused, and published stories are untouched. Each is tried again ${retry} after it failed, then given up. ` +
      (givenUp > 0
        ? `${countOf(givenUp, 'story', 'stories')} failed on ${givenUp === 1 ? 'its' : 'their'} last try and ${givenUp === 1 ? 'is' : 'are'} no longer linked automatically: attach any that belong from the story's Overview block. `
        : '') +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `stories-failing:${LINK_OVERVIEWS_JOB}`,
  })
}

/** "Linked 9 stories: 4 joined, 1 founded, 4 alone", with the outcomes that leave a story owed after it, the stories given up and those waiting on a freeze. */
export function linkSummary(
  outcomes: ReadonlyMap<string, LinkOutcome>,
  backlog: { taken: number; total: number } | null,
  waits: { givenUp: number; frozenWaiting: number } = { givenUp: 0, frozenWaiting: 0 },
): string {
  const n = (...wanted: LinkOutcome[]) => [...outcomes.values()].filter(o => wanted.includes(o)).length
  const optional = (count: number, words: string) => (count > 0 ? `, ${count.toLocaleString('en-US')} ${words}` : '')
  const line =
    `Linked ${countOf(outcomes.size, 'story', 'stories')}: ${n('joined')} joined, ${n('founded')} founded, ${n('none', 'rejected')} alone` +
    optional(n('held'), 'held by a frozen overview') +
    optional(n('conflict'), 'left for the next run') +
    optional(n('failed'), 'failed') +
    optional(waits.givenUp, 'given up after their last try') +
    optional(waits.frozenWaiting, 'waiting on a frozen overview')
  return backlog ? `${line}; backfill ${backlog.taken.toLocaleString('en-US')} of ${backlog.total.toLocaleString('en-US')}` : line
}

/** The retries on their last try that failed or conflicted again: given up. */
export const givenUpOf = (lastTries: readonly string[], outcomes: ReadonlyMap<string, LinkOutcome>): string[] =>
  lastTries.filter(id => outcomes.get(id) === 'failed' || outcomes.get(id) === 'conflict')

/** One run of the step at `now`; `calls` are production's model calls (a test gives scripted ones). */
export async function runLinkOverviewsJob(now: Date = new Date(), calls: OverviewCalls = productionCalls()): Promise<void> {
  const refusal = overviewSwitchRefusal()
  if (refusal || !(await overviewStepOn())) {
    const why = refusal ?? OVERVIEW_JOB_DISABLED
    log.info({ why }, 'overviews are off; nothing linked')
    reportRunResult(`${why}; nothing linked`)
    return
  }

  const slices = await owedStories(now)
  const stories = await linkStories(prisma, [...slices.backlog, ...slices.retries, ...slices.night])
  log.info(
    { backlog: slices.backlog.length, retries: slices.retries.length, night: slices.night.length, backlogTotal: slices.backlogTotal },
    'starting overview linking',
  )
  let switchedOff = false
  // A write that throws is rolled back: the story stays owed and the run goes on
  const apply: ApplyLink = (result, lastTry) =>
    applyLink(result, lastTry, now).catch((err: unknown) => {
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
  const run = await linkInOrder(stories, productionLinkDeps(calls), apply, { concurrency: config.overviews.concurrency, keepGoing })

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
    upkeep = await runUpkeep(productionUpkeepDeps(now, calls), { clock, now, today: utcDay(now) }, keepGoing)
    for (const e of upkeep.errors)
      log.error({ part: e.part, overviewId: e.id, error: sanitizedError(e.error) }, 'overview upkeep failed for an overview; it is tried again next run')
    log.info({ ...upkeep, errors: upkeep.errors.length, clock }, 'overview upkeep finished')
  }
  // Checked: joins proposed and stands lines written; failed: yeses code refused and stands lines dropped (each part never more than its checked)
  recordItems(proposed + (upkeep?.standsChecked ?? 0), refused + (upkeep?.standsDropped ?? 0))
  const givenUp = givenUpOf(slices.lastTries, run.outcomes).length
  if (failing(run.outcomes.size, failed) || givenUp > 0) await notifyFailedStories(run.outcomes.size, failed, givenUp).catch(() => {})
  if (upkeep && failing(upkeep.items, upkeep.failed)) await notifyFailedUpkeep(upkeep.items, upkeep.failed).catch(() => {})
  for (const f of upkeep?.freezes ?? []) await notifyFreeze(f).catch(() => {})
  for (const r of upkeep?.recenters ?? []) await notifyRecenter(r).catch(() => {})
  const left = stories.length - run.outcomes.size
  const linked =
    stories.length === 0
      ? `Nothing to link${slices.frozenWaiting > 0 ? `, ${slices.frozenWaiting.toLocaleString('en-US')} waiting on a frozen overview` : ''}`
      : linkSummary(run.outcomes, slices.backlogTotal > 0 ? { taken: slices.backlog.length, total: slices.backlogTotal } : null, {
          givenUp,
          frozenWaiting: slices.frozenWaiting,
        })
  const summary = upkeep ? `${linked}; ${upkeepSummary(upkeep)}` : linked
  reportRunResult(left > 0 && switchedOff ? `${summary}; ${left} left for the next run` : summary)
}
