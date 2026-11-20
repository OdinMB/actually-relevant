/**
 * One run of the overview step over injected reads, calls and writes (`.context/overviews.md`, "The
 * job"), the same in production (`runLinkOverviewsJob`) and in the eval's replay: the stories owed now
 * (`owedSlices`: the new backlog, the retries due, the night's) linked oldest first (`linkInOrder`),
 * the development clock the upkeep counts in (`upkeepClock`), then the upkeep (`runUpkeep`) unless the
 * step stopped meanwhile. Pure: nothing here reads or writes the database.
 */
import { linkInOrder, type ApplyLink, type LinkDeps, type OrderedRun } from './overviewLink.js'
import type { OwedSlices } from './overviewOwed.js'
import type { LinkOutcome, LinkStory } from './overviewTypes.js'
import { runUpkeep, type UpkeepDeps, type UpkeepTally } from './overviewUpkeep.js'

export interface NightDeps {
  /** The stories owed now, sliced: production's `owedStories`, the sandbox's by the same rule. */
  owed(): Promise<OwedSlices>
  /** The stories as linking reads them, in the order asked. */
  stories(ids: string[]): Promise<LinkStory[]>
  link: LinkDeps
  apply: ApplyLink
  upkeep: UpkeepDeps
}

export interface Night {
  slices: OwedSlices
  /** The stories it took, in the order they were linked. */
  stories: LinkStory[]
  run: OrderedRun
  /** The development clock the upkeep counted in. */
  clock: Date
  /** Null when the step stopped before the upkeep. */
  upkeep: UpkeepTally | null
  /** The retries on their last try whose stored outcome failed or conflicted again: given up, nothing links them again by itself. */
  givenUp: string[]
}

/**
 * The development time the status machine counts in (`.context/overviews.md`, "The job"): while a
 * backfill drains (older new stories left after this run's slice), the newest story this run linked,
 * so an overview formed from May's stories does not fade in November before its later stories join;
 * otherwise now.
 */
export function upkeepClock(slices: Pick<OwedSlices, 'backlog' | 'backlogTotal'>, linked: readonly LinkStory[], now: Date): Date {
  if (slices.backlogTotal <= slices.backlog.length || linked.length === 0) return now
  return new Date(Math.max(...linked.map(s => s.datePublished.getTime())))
}

/**
 * The retries on their last try whose stored outcome failed or conflicted again. A write that threw
 * stored nothing (`OrderedRun.unwritten`), so its story is owed as before and not given up.
 */
export const givenUpOf = (lastTries: readonly string[], outcomes: ReadonlyMap<string, LinkOutcome>): string[] =>
  lastTries.filter(id => outcomes.get(id) === 'failed' || outcomes.get(id) === 'conflict')

/**
 * One night: the owed stories linked in order (link calls `concurrency` at once, writes one at a
 * time), then, unless `keepGoing` says no after them, the upkeep at the development clock, `now` and
 * `today`. `keepGoing` is asked before each write and each upkeep item, as the switch is.
 */
export async function runNight(
  deps: NightDeps,
  at: { now: Date; today: string },
  options: { concurrency: number; keepGoing: () => Promise<boolean> },
): Promise<Night> {
  const slices = await deps.owed()
  const stories = await deps.stories([...slices.backlog, ...slices.retries, ...slices.night])
  const run = await linkInOrder(stories, deps.link, deps.apply, options)
  const clock = upkeepClock(
    slices,
    stories.filter(s => run.outcomes.has(s.id)),
    at.now,
  )
  const upkeep = (await options.keepGoing()) ? await runUpkeep(deps.upkeep, { clock, now: at.now, today: at.today }, options.keepGoing) : null
  return { slices, stories, run, clock, upkeep, givenUp: givenUpOf(slices.lastTries, run.outcomes) }
}
