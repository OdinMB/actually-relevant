/**
 * Which jobs are chains and which are their steps (chains.ts runs them; `.context/scheduler.md`,
 * "Chains"), which of their steps do not stop them on a failure, and the clock times a step's "not
 * before" setting holds (a chain's flex cut-off is in hours from its start). No imports, so the scheduler,
 * the job list and the chain runner can all read it.
 */

/** Every chain and its steps, in the order they run. A job is a step of one chain at most. */
export const CHAINS: Readonly<Record<string, readonly string[]>> = {
  // Several times a day: a feed lists only its newest articles, so a once-a-day crawl would lose a busy
  // feed's articles. Crawled stories are assessed in the same run: a person's part starts with assessed stories
  intake_chain: ['crawl_feeds', 'preassess_stories', 'assess_stories'],
  // Story context comes before publishing, so stories go out with their cards (owner decision 2026-11-17,
  // .context/story-context.md); its failure does not stop the edition (GOES_ON_PAST_FAILURE). The research
  // pass replaces both once switched on (.context/research-passes.md): one of the two kinds runs, the other is off.
  // Overview linking comes after publishing: it needs published stories and never holds the edition (.context/overviews.md)
  daily_edition_chain: ['select_stories', 'research_stories', 'build_story_context', 'research_pass', 'publish_stories', 'link_overviews'],
  // Saturday morning: each edition's issue is built (with its test email), then sent
  newsletter_chain: ['generate_newsletter', 'publish_newsletter', 'generate_uplifting_newsletter', 'publish_uplifting_newsletter'],
  // Friday's one run builds both shows' episodes (a failed build is retried within the run); both
  // publish steps are held until Saturday 07:00 in Berlin, so an episode is ready well before it goes out
  podcast_chain: ['generate_podcast', 'generate_uplifting_podcast', 'publish_podcast', 'publish_uplifting_podcast'],
}

/**
 * Steps whose failure does not stop their chain: the step's own Error and failure notice stand, and
 * the chain goes on with the next step (a Review on it still pauses), and its end parts run. Story
 * context runs before publishing, and its failure must never hold the edition: its stories publish
 * without cards. Overview linking runs after publishing, and its failure must not fail the chain run
 * or skip story context's after-publish part: its stories are linked at the next run.
 */
export const GOES_ON_PAST_FAILURE: ReadonlySet<string> = new Set(['build_story_context', 'link_overviews'])

export const isChain = (jobName: string): boolean => CHAINS[jobName] !== undefined

/** The chain `jobName` is a step of, or null. */
export function chainOf(jobName: string): string | null {
  for (const [chain, steps] of Object.entries(CHAINS)) if (steps.includes(jobName)) return chain
  return null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const STEP_TIME = /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?([01]\d|2[0-3]):([0-5]\d)$/

/** Whether `value` is a step's "not before" time: "HH:MM", or a weekday and a time, "Sat 07:00". */
export const isStepTime = (value: string): boolean => STEP_TIME.test(value)

/** The wall-clock date and weekday in `timeZone` at `at`. */
function zonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find(p => p.type === type)!.value
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  }
}

/** The instant a wall-clock time in `timeZone` names (the later reading across a DST change is fine here). */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offsetAt = (instant: number) => {
    const p = zonedParts(new Date(instant), timeZone)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
  }
  const first = asUtc - offsetAt(asUtc)
  return new Date(asUtc - offsetAt(first))
}

/**
 * The first moment after `from` at a step's "not before" time, read on `timeZone`'s clock: the time
 * on any day for "HH:MM", on that weekday for "Sat 07:00". Null without a value or for a bad one.
 */
export function nextStepTime(spec: string | null, from: Date, timeZone: string): Date | null {
  const match = spec ? STEP_TIME.exec(spec) : null
  if (!match) return null
  const [, weekday, hour, minute] = match
  const start = zonedParts(from, timeZone)
  for (let offset = 0; offset <= 8; offset++) {
    // Noon UTC on the local date plus `offset` days names that calendar day whatever the zone
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset, 12))
    if (weekday && WEEKDAYS[day.getUTCDay()] !== weekday) continue
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Number(hour), Number(minute), timeZone)
    if (at.getTime() > from.getTime()) return at
  }
  return null
}
