/**
 * The overview step, the `link_overviews` job (`.context/overviews.md`, "The job"), the daily
 * edition's step after publishing: it links each published story it still owes a link decision
 * (`overviewQueue.ts`), the backlog's slice (the backfill, at most `backfillPerRun`) first and then
 * the night's (at most `perRun`), each oldest first; link calls `concurrency` at a time, every write
 * one story at a time in that order (`linkInOrder`, `applyLink`). It runs only while its gate and
 * research passes' gate are open and its job is enabled, re-reading that before each write, so a run
 * by hand of the disabled job does nothing. A story is settled by its `link` decision, so a run a
 * restart cut off resumes where it stopped. Stories that fail go on to the next run; a failure of the
 * job as a whole never stops its chain (`GOES_ON_PAST_FAILURE`). The item tally (joins proposed, and
 * those code refused) goes into the run's usage (`recordItems`) for the failure-share notice.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import prisma from '../lib/prisma.js'
import { notify } from '../lib/notify.js'
import { sanitizedError } from '../lib/runErrors.js'
import { countOf, recordItems, reportRunResult } from '../lib/runUsage.js'
import { buildFoundCheckPrompt, buildFoundPrompt, buildLinkPromptParts } from '../prompts/overviews.js'
import { foundCheckSchema, foundSchema, linkSchema } from '../schemas/overviews.js'
import { membershipsOf, nearestPublished } from '../services/overviewCandidates.js'
import { candidateOverviews, linkStories } from '../services/overviewInput.js'
import { applyLink } from '../services/overviewLifecycle.js'
import { linkInOrder, type ApplyLink, type LinkDeps } from '../services/overviewLink.js'
import { LINK_OVERVIEWS_JOB, overviewStepOn, overviewSwitchRefusal, owedStories } from '../services/overviewQueue.js'
import type { LinkOutcome } from '../services/overviewTypes.js'
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
  const run = await linkInOrder(stories, productionLinkDeps(), apply, {
    concurrency: config.overviews.concurrency,
    keepGoing: async () => {
      if (!switchedOff && !(await overviewStepOn())) {
        log.info('overview step switched off; writing no other story')
        switchedOff = true
      }
      return !switchedOff
    },
  })

  const proposed = run.results.reduce((sum, r) => sum + r.proposed, 0)
  const refused = run.results.reduce((sum, r) => sum + r.refusals.length, 0)
  recordItems(proposed, refused)
  const failed = [...run.outcomes.values()].filter(o => o === 'failed').length
  for (const r of run.results)
    if (r.error) log.error({ storyId: r.story.id, error: sanitizedError(r.error) }, 'linking a story failed; it is tried again next run')
  log.info({ stories: run.outcomes.size, proposed, refused, failed }, 'overview linking finished')
  if (storiesFailing(run.outcomes.size, failed)) await notifyFailedStories(run.outcomes.size, failed).catch(() => {})
  const left = stories.length - run.outcomes.size
  const summary =
    stories.length === 0
      ? 'Nothing to link'
      : linkSummary(run.outcomes, slices.backlogTotal > 0 ? { taken: slices.backlog.length, total: slices.backlogTotal } : null)
  reportRunResult(left > 0 && switchedOff ? `${summary}; ${left} left for the next run` : summary)
}
