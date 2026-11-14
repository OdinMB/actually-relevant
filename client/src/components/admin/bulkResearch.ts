import type { ResearchBulkApplyOutcome, ResearchUsage, TaskSkip, TaskState } from '@shared/types'

/**
 * The stories list's two research actions in words (`.context/story-research.md`, "Bulk research"
 * and "Bulk apply"): when each can run, what it asks before it does, and what it reports after.
 */

/** Stories one bulk research action takes (server: `config.research.bulkMaxStories`). */
export const RESEARCH_BULK_MAX = 50

/** Stories the outcome names per kind; the rest are counted. */
const NAMED_SKIPS = 10

/** A chosen story as the outcome names it. */
export interface BulkResearchStory {
  id: string
  title: string
}

const money = (v: number) => `$${v.toFixed(2)}`
const storyCount = (n: number) => `${n} ${n === 1 ? 'story' : 'stories'}`

/**
 * Why a research action of the stories list does nothing now (`reason`, read from the usage), null
 * when it may run, or undefined to leave it out: against a backend without research (its usage
 * answers 404, read as null) and while the usage loads. Each story's own refusals are the server's,
 * given per story in the outcome.
 */
function actionRefusal(
  count: number,
  usage: ResearchUsage | null | undefined,
  usageFailed: boolean,
  verb: string,
  reason: (usage: ResearchUsage) => string | null,
): string | null | undefined {
  if (usage === null || (usage === undefined && !usageFailed)) return undefined
  if (count > RESEARCH_BULK_MAX) return `Select at most ${RESEARCH_BULK_MAX} stories to ${verb} at once`
  if (usage === undefined) return 'Research usage could not be loaded'
  return reason(usage)
}

/** Research: refused while no run can start (switched off, the cap reached); a story's status, a run in progress or the cap reached during the batch skip that story. */
export function bulkResearchRefusal(count: number, usage: ResearchUsage | null | undefined, usageFailed: boolean): string | null | undefined {
  return actionRefusal(count, usage, usageFailed, 'research', u => u.refusal)
}

/** "Use researched versions": refused while no run can be applied (switched off, the owner's gate closed), whatever refuses a new run. */
export function bulkApplyRefusal(count: number, usage: ResearchUsage | null | undefined, usageFailed: boolean): string | null | undefined {
  return actionRefusal(count, usage, usageFailed, 'apply', u => u.applyRefusal)
}

/** The confirmation: the count, and every run at its reservation as the cost's upper bound. */
export function bulkResearchConfirmation(count: number, usage: ResearchUsage): { title: string; description: string } {
  const bound = count * usage.reservationUsd
  const left = Math.max(0, usage.monthlyCapUsd - usage.monthToDateUsd)
  const month =
    bound > left
      ? `That is more than the ${money(left)} left this month: a story the cap leaves no room for is skipped.`
      : `This month: ${money(usage.monthToDateUsd)} of ${money(usage.monthlyCapUsd)} spent.`
  return {
    title: `Research ${storyCount(count)}?`,
    description: [
      `Each run writes a cited draft and changes nothing on its story until you use its version.`,
      `Up to ${money(bound)}: each run reserves ${money(usage.reservationUsd)} until it ends.`,
      month,
      `A story that can't be researched now is skipped, with the reason.`,
    ].join(' '),
  }
}

/** The confirmation: the count, what each story's texts and emotion tag become, and how to take it back. */
export function bulkApplyConfirmation(count: number): { title: string; description: string } {
  return {
    title: `Use the researched version of ${storyCount(count)}?`,
    description: [
      `Each story takes the version of its newest research run, as "Use this version" would: the researched headline, summary, analysis and emotion tag replace its own, with the run's sources and the researched label, and it keeps its own rating.`,
      `Published stories change for readers at once.`,
      `A story is skipped with the reason when its newest run can't be applied, is already applied, or found the story old news or contradicted by other reports: review such a run on the story's own page.`,
      `"Revert to single-source" on a story gives back its earlier version.`,
    ].join(' '),
  }
}

/** Each story by its title with a reason (`Skipped "…": …`), the first ten named and the rest counted. */
function namedStories(verb: string, entries: TaskSkip[], chosen: BulkResearchStory[]): string[] {
  const titles = new Map(chosen.map(s => [s.id, s.title]))
  const named = entries.slice(0, NAMED_SKIPS).map(e => `${verb} "${titles.get(e.storyId) ?? 'a story no longer listed'}": ${e.reason}`)
  return entries.length > NAMED_SKIPS ? [...named, `and ${entries.length - NAMED_SKIPS} more ${verb.toLowerCase()}`] : named
}

/**
 * The finished task in words: how many stories were researched (a run that ended, whatever its
 * verdict), failed and skipped, then each skipped story by title with its reason, the first ten
 * named. It stays until dismissed when anything was skipped or failed, so the reasons can be read.
 */
export function bulkResearchOutcome(label: string, task: TaskState, chosen: BulkResearchStory[]): { message: string; sticky: boolean } {
  const skipped = task.skipped ?? []
  const counts = [
    `${task.completed} researched`,
    ...(task.failed > 0 ? [`${task.failed} failed`] : []),
    ...(skipped.length > 0 ? [`${skipped.length} skipped`] : []),
  ]
  const unapplied = task.completed > 0 ? " Nothing was applied: open a story to use a run's version." : ''
  return {
    message: [`${label}: ${counts.join(', ')}.${unapplied}`, ...namedStories('Skipped', skipped, chosen)].join('\n'),
    sticky: skipped.length > 0 || task.failed > 0,
  }
}

/**
 * The bulk apply's answer in words: how many stories took their researched version, failed and were
 * skipped (a run research found old news or contradicted among them), then by title each that
 * failed and each skipped, with why. It stays until dismissed when any was named.
 */
export function bulkApplyOutcome(
  label: string,
  outcomes: ResearchBulkApplyOutcome[],
  chosen: BulkResearchStory[],
): { type: 'success' | 'error'; message: string; sticky: boolean } {
  const applied = outcomes.filter(o => o.outcome === 'applied').length
  const failed = outcomes.flatMap(o => (o.outcome === 'failed' ? [o] : []))
  const skipped = outcomes.flatMap(o => (o.outcome === 'skipped' ? [o] : []))
  const counts = [`${applied} applied`, ...(failed.length > 0 ? [`${failed.length} failed`] : []), ...(skipped.length > 0 ? [`${skipped.length} skipped`] : [])]
  return {
    type: failed.length > 0 ? 'error' : 'success',
    message: [`${label}: ${counts.join(', ')}.`, ...namedStories('Failed', failed, chosen), ...namedStories('Skipped', skipped, chosen)].join('\n'),
    sticky: failed.length + skipped.length > 0,
  }
}
