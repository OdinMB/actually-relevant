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
 * restart cut off resumes where it stopped. Then the upkeep (`overviewUpkeep.ts`): the status machine
 * in development time (`upkeepClock`), the automated re-centers and the reviews due and the monthly
 * audit, the stands refreshes due. Stories and overviews that fail go on to the next run; a
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
import { applyAudit, applyBurst, applyLink, applyRecenter, applyReview, applyStands, applyStatus } from '../services/overviewLifecycle.js'
import type { ApplyLink, LinkDeps } from '../services/overviewLink.js'
import { runNight } from '../services/overviewNight.js'
import { LINK_OVERVIEWS_JOB, overviewStepOn, overviewSwitchRefusal, owedStories } from '../services/overviewQueue.js'
import { overviewCalls, type OverviewCalls } from '../services/overviewSteps.js'
import type { LinkOutcome } from '../services/overviewTypes.js'
import { recenterCases } from '../services/overviewRecenterInput.js'
import type { UpkeepDeps, UpkeepFreeze, UpkeepRecenter, UpkeepTally } from '../services/overviewUpkeep.js'
import { auditPicks, overviewStates, reviewCase, standsCases } from '../services/overviewUpkeepInput.js'
import { structuredCall } from '../services/structuredCall.js'
import { jobDisplayName } from './jobDisplayName.js'

export { LINK_OVERVIEWS_JOB }

const log = createLogger(LINK_OVERVIEWS_JOB)

/** Why the step does nothing while its gates are open: its job is disabled. */
export const OVERVIEW_JOB_DISABLED = 'Overviews are switched off: the link_overviews job is disabled on the Jobs page'

/** The step's model calls as production makes them: `structuredCall` at each step's tier and effort (`overviewSteps.ts`). */
export const productionCalls = (): OverviewCalls =>
  overviewCalls((step, prompt) => structuredCall(step.tier, step.schema, prompt, step.effort ? { effort: step.effort } : {}))

/** Linking as production runs it: the tables, read as they stand at each step (the re-center limits and waits at the run's `now`), and the step's calls. */
export const productionLinkDeps = (calls: OverviewCalls = productionCalls(), now: Date = new Date()): LinkDeps => ({
  neighbours: story => nearestPublished(prisma, story.id, story.datePublished),
  memberships: (ids, asOf) => membershipsOf(prisma, ids, asOf, now),
  overviews: (ids, asOf) => candidateOverviews(prisma, ids, asOf),
  stories: ids => linkStories(prisma, ids),
  now: () => now,
  ...calls.link,
})

/** The upkeep as production runs it: the tables, the lifecycle's writes, and the step's calls (the audit at high effort). */
export const productionUpkeepDeps = (now: Date, calls: OverviewCalls = productionCalls()): UpkeepDeps => ({
  states: () => overviewStates(prisma, now),
  reviewCase: id => reviewCase(prisma, id),
  auditPicks: at => auditPicks(prisma, at),
  standsCases: today => standsCases(prisma, today),
  recenterCases: at => recenterCases(prisma, at),
  review: calls.review,
  stands: calls.stands,
  recenter: calls.recenter,
  applyStatus: (state, moves, clock) => applyStatus(state, moves, clock, now),
  applyBurst: state => applyBurst(state, now),
  applyRecenter: (c, result) => applyRecenter(c, result, now),
  applyReview: (c, result) => applyReview(c, result, now),
  applyAudit: (c, result) => applyAudit(c, result, now),
  applyStands: (c, result, record, today) => applyStands(c, result, record, today),
})

/** "; 3 overviews refreshed, 1 reviewed", and what else the upkeep did when it did it. */
export function upkeepSummary(t: UpkeepTally): string {
  const parts = [`${countOf(t.standsWritten, 'overview', 'overviews')} refreshed`, `${t.reviews.toLocaleString('en-US')} reviewed`]
  if (t.recenters.length > 0) parts.push(`${t.recenters.length.toLocaleString('en-US')} re-centered`)
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
      'A technical problem stopped status moves, automated re-center attempts, reviews, the monthly audit or "Where this stands" refreshes: the AI service did not answer, or an error of ours. ' +
      'Nothing paused, and the overviews keep what they had. They are tried again at the next run. ' +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `upkeep-failing:${LINK_OVERVIEWS_JOB}`,
  })
}

/**
 * The owner's notice of stories whose linking failed: past the failure share, or whenever a story was
 * given up (its last retry's stored outcome failed or conflicted too), which nothing links again by
 * itself. `failed` and `givenUp` count stored outcomes; `unwritten` counts the stories whose write
 * threw and stored nothing, technical failures too, which are owed again at the next run as before.
 */
export async function notifyFailedStories(taken: number, failed: number, givenUp: number, unwritten = 0): Promise<void> {
  const days = config.overviews.retryAfterDays
  const last = countOf(days.at(-1) ?? 0, 'day', 'days')
  const retry = days.length > 1 ? `${days.slice(0, -1).join(', ')} and ${last}` : last
  await notify({
    source: 'jobs',
    severity: 'warning',
    title:
      `${jobDisplayName(LINK_OVERVIEWS_JOB)}: ${(failed + unwritten).toLocaleString('en-US')} of ${countOf(taken, 'story', 'stories')} failed in the last run` +
      (unwritten > 0 ? `, ${unwritten.toLocaleString('en-US')} not written` : '') +
      (givenUp > 0 ? `, ${givenUp.toLocaleString('en-US')} given up` : ''),
    message:
      'A technical problem stopped their linking: the AI service did not answer, a write conflicted, or an error of ours. ' +
      `Nothing paused, and published stories are untouched. Each is tried again ${retry} after it failed, then given up. ` +
      (unwritten > 0
        ? `${countOf(unwritten, 'story', 'stories')} could not be stored (an error of ours): nothing of ${unwritten === 1 ? 'its' : 'their'} linking was kept, and ${unwritten === 1 ? 'it is' : 'they are'} tried again at the next run. `
        : '') +
      (givenUp > 0
        ? `${countOf(givenUp, 'story', 'stories')} failed on ${givenUp === 1 ? 'its' : 'their'} last try and ${givenUp === 1 ? 'is' : 'are'} no longer linked automatically: attach any that belong from the story's Overview block. `
        : '') +
      'Switch the step off on the Jobs page if it keeps happening.',
    link: '/admin/jobs',
    dedupeKey: `stories-failing:${LINK_OVERVIEWS_JOB}`,
  })
}

/**
 * "Linked 9 stories: 4 joined, 1 founded, 4 alone", by stored outcome, with the outcomes that leave a
 * story owed after it, the stories whose write stored nothing, those given up and those waiting on a
 * freeze or for a re-center.
 */
export function linkSummary(
  outcomes: ReadonlyMap<string, LinkOutcome>,
  backlog: { taken: number; total: number } | null,
  waits: { givenUp: number; frozenWaiting: number; recenterWaiting?: number; unwritten?: number } = { givenUp: 0, frozenWaiting: 0 },
): string {
  const n = (...wanted: LinkOutcome[]) => [...outcomes.values()].filter(o => wanted.includes(o)).length
  const optional = (count: number, words: string) => (count > 0 ? `, ${count.toLocaleString('en-US')} ${words}` : '')
  const line =
    `Linked ${countOf(outcomes.size, 'story', 'stories')}: ${n('joined')} joined, ${n('founded')} founded, ${n('none', 'rejected')} alone` +
    optional(n('held'), 'held by a frozen overview') +
    optional(n('waiting'), 'held for an overview to widen') +
    optional(n('conflict'), 'left for the next run') +
    optional(n('failed'), 'failed') +
    optional(waits.unwritten ?? 0, 'not written (tried again next run)') +
    optional(waits.givenUp, 'given up after their last try') +
    optional(waits.frozenWaiting, 'waiting on a frozen overview') +
    optional(waits.recenterWaiting ?? 0, 'waiting for an overview to widen')
  return backlog ? `${line}; backfill ${backlog.taken.toLocaleString('en-US')} of ${backlog.total.toLocaleString('en-US')}` : line
}

/** One run of the step at `now`; `calls` are production's model calls (a test gives scripted ones). */
export async function runLinkOverviewsJob(now: Date = new Date(), calls: OverviewCalls = productionCalls()): Promise<void> {
  const refusal = overviewSwitchRefusal()
  if (refusal || !(await overviewStepOn())) {
    const why = refusal ?? OVERVIEW_JOB_DISABLED
    log.info({ why }, 'overviews are off; nothing linked')
    reportRunResult(`${why}; nothing linked`)
    return
  }

  let switchedOff = false
  // A write that throws is rolled back and stores nothing: the story stays owed as it was, and the run goes on
  const apply: ApplyLink = (result, lastTry) =>
    applyLink(result, lastTry, now).catch((err: unknown) => {
      log.error({ storyId: result.story.id, error: sanitizedError(err) }, 'writing the linking of a story failed; it is tried again next run')
      return { kind: 'unwritten' } as const
    })
  const keepGoing = async () => {
    if (!switchedOff && !(await overviewStepOn())) {
      log.info('overview step switched off; writing nothing else')
      switchedOff = true
    }
    return !switchedOff
  }
  const owed = async () => {
    const slices = await owedStories(now)
    log.info(
      { backlog: slices.backlog.length, retries: slices.retries.length, night: slices.night.length, backlogTotal: slices.backlogTotal },
      'starting overview linking',
    )
    return slices
  }
  // Part 1, linking; then parts 2 to 4: the status machine, re-centers, reviews and the audit, the stands (none once switched off)
  const night = await runNight(
    {
      owed,
      stories: ids => linkStories(prisma, ids),
      link: productionLinkDeps(calls, now),
      apply,
      upkeep: productionUpkeepDeps(now, calls),
    },
    { now, today: utcDay(now) },
    { concurrency: config.overviews.concurrency, keepGoing },
  )
  const { slices, stories, run, upkeep } = night

  const proposed = run.results.reduce((sum, r) => sum + r.proposed, 0)
  const refused = run.results.reduce((sum, r) => sum + r.refusals.length, 0)
  // Stored failures, and the stories whose write stored nothing: both technical failures of this run
  const failed = [...run.outcomes.values()].filter(o => o === 'failed').length
  const unwritten = run.unwritten.length
  const taken = run.outcomes.size + unwritten
  for (const r of run.results)
    if (r.error) log.error({ storyId: r.story.id, error: sanitizedError(r.error) }, 'linking a story failed; it is tried again next run')
  log.info({ stories: run.outcomes.size, proposed, refused, failed, unwritten, givenUp: night.givenUp.length }, 'overview linking finished')
  if (upkeep) {
    for (const e of upkeep.errors)
      log.error({ part: e.part, overviewId: e.id, error: sanitizedError(e.error) }, 'overview upkeep failed for an overview; it is tried again next run')
    log.info({ ...upkeep, errors: upkeep.errors.length, clock: night.clock }, 'overview upkeep finished')
  }
  // Checked: joins proposed and stands lines written; failed: yeses code refused and stands lines dropped (each part never more than its checked)
  recordItems(proposed + (upkeep?.standsChecked ?? 0), refused + (upkeep?.standsDropped ?? 0))
  const givenUp = night.givenUp.length
  if (failing(taken, failed + unwritten) || givenUp > 0) await notifyFailedStories(taken, failed, givenUp, unwritten).catch(() => {})
  if (upkeep && failing(upkeep.items, upkeep.failed)) await notifyFailedUpkeep(upkeep.items, upkeep.failed).catch(() => {})
  for (const f of upkeep?.freezes ?? []) await notifyFreeze(f).catch(() => {})
  for (const r of upkeep?.recenters ?? []) await notifyRecenter(r).catch(() => {})
  const left = stories.length - taken
  const linked =
    stories.length === 0
      ? `Nothing to link${slices.frozenWaiting > 0 ? `, ${slices.frozenWaiting.toLocaleString('en-US')} waiting on a frozen overview` : ''}${slices.recenterWaiting > 0 ? `, ${slices.recenterWaiting.toLocaleString('en-US')} waiting for an overview to widen` : ''}`
      : linkSummary(run.outcomes, slices.backlogTotal > 0 ? { taken: slices.backlog.length, total: slices.backlogTotal } : null, {
          givenUp,
          frozenWaiting: slices.frozenWaiting,
          recenterWaiting: slices.recenterWaiting,
          unwritten,
        })
  const summary = upkeep ? `${linked}; ${upkeepSummary(upkeep)}` : linked
  reportRunResult(left > 0 && switchedOff ? `${summary}; ${left} left for the next run` : summary)
}
