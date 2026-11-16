/**
 * Which jobs are chains and which are their steps (chains.ts runs them; `.context/scheduler.md`,
 * "Chains"), and the clock times a chain's and a step's settings hold. No imports, so the scheduler,
 * the job list and the chain runner can all read it.
 */

/** Every chain and its steps, in the order they run. A job is a step of one chain at most. */
export const CHAINS: Readonly<Record<string, readonly string[]>> = {
  // Several times a day: a feed lists only its newest articles, so a once-a-day crawl would lose a busy
  // feed's articles. Crawled stories are assessed in the same run: a person's part starts with assessed stories
  intake_chain: ['crawl_feeds', 'preassess_stories', 'assess_stories'],
  daily_edition_chain: ['select_stories', 'research_stories', 'publish_stories'],
  // Saturday morning: each edition's issue is built (with its test email), then sent
  newsletter_chain: ['generate_newsletter', 'publish_newsletter', 'generate_uplifting_newsletter', 'publish_uplifting_newsletter'],
  // Friday's slots build both shows' episodes (each slot resumes or retries the week's episode); both
  // publish steps are held until Saturday 07:00 in Berlin, so an episode is ready well before it goes out
  podcast_chain: ['generate_podcast', 'generate_uplifting_podcast', 'publish_podcast', 'publish_uplifting_podcast'],
}

export const isChain = (jobName: string): boolean => CHAINS[jobName] !== undefined

/** The chain `jobName` is a step of, or null. */
export function chainOf(jobName: string): string | null {
  for (const [chain, steps] of Object.entries(CHAINS)) if (steps.includes(jobName)) return chain
  return null
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Whether `value` is a time of day as the chain settings hold it, "HH:MM" on the 24-hour clock. */
export const isClockTime = (value: string): boolean => CLOCK_TIME.test(value)

/** The first moment at `hhmm` UTC after `from`; null without a value or for one that is not "HH:MM". */
export function nextClockTime(hhmm: string | null, from: Date): Date | null {
  return hhmm && isClockTime(hhmm) ? nextStepTime(hhmm, from, 'UTC') : null
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
