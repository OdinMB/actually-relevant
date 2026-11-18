/**
 * The failure share (`.context/scheduler.md`, "Failure share"): a job whose checks judge what a
 * model wrote counts the items in its run's usage (`recordItems`). When more than
 * `config.jobs.failureShare.share` of at least `minItems` failed, the Jobs page warns under the job
 * (`failureShareWarning`, jobNotes.ts) and the run's finish (`finishJobRun`) records one warning
 * notice, deduped per job as `step-failing:<job>` and reopened by a repeat. Nothing pauses. The
 * notice is titled by the job's name; a job may word its own message (`FAILURE_SHARE_MESSAGES`).
 */
import { config } from '../config.js'
import type { RunUsage } from '../lib/runUsage.js'
import type { NoticeInput } from '../services/adminNotices.js'
import { jobDisplayName } from './jobDisplayName.js'

/** Whether a run's tally passes the failure share: more than `share` failed of at least `minItems` checked. */
export function failureShareExceeded(checked: number, failed: number): boolean {
  const { share, minItems } = config.jobs.failureShare
  return checked >= minItems && failed / checked > share
}

/** "14 of 45 checked items failed in the last run.": the Jobs page's warning, and the notice's title. */
export const failureShareLine = (checked: number, failed: number) =>
  `${failed.toLocaleString('en-US')} of ${checked.toLocaleString('en-US')} checked ${checked === 1 ? 'item' : 'items'} failed in the last run.`

/** A job's own words for the notice, for the people who run the site; any other job gets the plain message. */
export const FAILURE_SHARE_MESSAGES: Readonly<Record<string, string>> = {
  build_story_context:
    'The checks dropped more of what the step wrote than usual. Nothing paused, and readers see only what passed. ' +
    "Each story's Context section shows what was dropped and why; switch the step off on the Jobs page if it keeps happening.",
}

const PLAIN_MESSAGE = 'Its checks failed more of what it wrote than usual. Nothing paused; switch it off on the Jobs page if it keeps happening.'

/** The notice a finished run records for its failure share, or null when the share holds. */
export function failureShareNotice(jobName: string, usage: RunUsage): NoticeInput | null {
  const { itemsChecked: checked, itemsFailed: failed } = usage
  if (!failureShareExceeded(checked, failed)) return null
  return {
    source: 'jobs',
    severity: 'warning',
    title: `${jobDisplayName(jobName)}: ${failureShareLine(checked, failed).replace(/\.$/, '')}`,
    message: FAILURE_SHARE_MESSAGES[jobName] ?? PLAIN_MESSAGE,
    link: '/admin/jobs',
    dedupeKey: `step-failing:${jobName}`,
  }
}
