/**
 * Which jobs are chains and which are their steps (chains.ts runs them; `.context/scheduler.md`,
 * "Chains"), and the clock times a chain's settings hold. No imports, so the scheduler, the job list
 * and the chain runner can all read it.
 */

/** Every chain and its steps, in the order they run. A job is a step of one chain at most. */
export const CHAINS: Readonly<Record<string, readonly string[]>> = {
  // Crawling stays a job of its own, several times a day: a feed lists only its newest articles, so a
  // once-a-day crawl would lose a busy feed's articles before they are read
  daily_edition_chain: ['preassess_stories', 'assess_stories', 'select_stories', 'research_stories', 'publish_stories', 'social_auto_post'],
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
  const match = hhmm ? CLOCK_TIME.exec(hhmm) : null
  if (!match) return null
  const at = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), Number(match[1]), Number(match[2])))
  if (at.getTime() <= from.getTime()) at.setUTCDate(at.getUTCDate() + 1)
  return at
}
