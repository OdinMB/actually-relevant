import type { ResearchUsage, TaskState } from '@shared/types'

/** Stories one bulk Research takes (server: `config.research.bulkMaxStories`). */
export const RESEARCH_BULK_MAX = 50

/** Skipped stories the outcome names; the rest are counted. */
const NAMED_SKIPS = 10

/** A chosen story as the outcome names it. */
export interface BulkResearchStory {
  id: string
  title: string
}

const money = (v: number) => `$${v.toFixed(2)}`
const storyCount = (n: number) => `${n} ${n === 1 ? 'story' : 'stories'}`

/**
 * Why the stories list's Research does nothing now, null when it may start, or undefined to leave it
 * out: against a backend without research (its usage answers 404, read as null) and while the usage
 * loads. Each story's own refusals (status, a run in progress, the cap reached during the batch) are
 * the server's, given per story in the outcome.
 */
export function bulkResearchRefusal(count: number, usage: ResearchUsage | null | undefined, usageFailed: boolean): string | null | undefined {
  if (usage === null || (usage === undefined && !usageFailed)) return undefined
  if (count > RESEARCH_BULK_MAX) return `Select at most ${RESEARCH_BULK_MAX} stories to research at once`
  if (usage === undefined) return 'Research usage could not be loaded'
  return usage.refusal
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
  const titles = new Map(chosen.map(s => [s.id, s.title]))
  const named = skipped.slice(0, NAMED_SKIPS).map(s => `Skipped "${titles.get(s.storyId) ?? 'a story no longer listed'}": ${s.reason}`)
  const rest = skipped.length > NAMED_SKIPS ? [`and ${skipped.length - NAMED_SKIPS} more skipped`] : []
  const unapplied = task.completed > 0 ? " Nothing was applied: open a story to use a run's version." : ''
  return {
    message: [`${label}: ${counts.join(', ')}.${unapplied}`, ...named, ...rest].join('\n'),
    sticky: skipped.length > 0 || task.failed > 0,
  }
}
