/**
 * The eval copy's time window (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud
 * Evals"): how the export command is asked for it (`--months <n>`, `--all`), where it starts, and how
 * a copy's header records and the commands print it. Which rows a window brings in is `selection.ts`'s.
 */

/** The owner's decision (2026-11-26): six months of stories, a file small enough to upload through a chat. */
export const DEFAULT_WINDOW_MONTHS = 6

/** What the export is asked for: the calendar months back from the export, or every story. */
export type WindowChoice = number | 'all'

/** What a copy's header records: the months and the cutoff they gave, or every story. */
export type CopyWindow = { months: number; since: string } | 'all'

/** `months` calendar months before `now`, at the same time of day (UTC); a day the month lacks is its last. */
export function windowStart(now: Date, months: number): Date {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const start = new Date(now)
  start.setUTCFullYear(first.getUTCFullYear(), first.getUTCMonth(), Math.min(now.getUTCDate(), lastDay))
  return start
}

export const copyWindow = (choice: WindowChoice, now: Date): CopyWindow =>
  choice === 'all' ? 'all' : { months: choice, since: windowStart(now, choice).toISOString() }

/** What a copy holds, in words, for the commands' output. */
export const describeWindow = (w: CopyWindow): string =>
  w === 'all' ? 'every story (--all)' : `the stories first seen since ${w.since} (${w.months} months before the export), and every older one its rows point at`

/** The window flags: `--months <n>` (a whole number from 1), `--all`, or neither for the default. Throws on anything else. */
export function parseWindowArgs(argv: readonly string[]): WindowChoice {
  const all = argv.includes('--all')
  const at = argv.indexOf('--months')
  if (all && at >= 0) throw new Error('choose either --months <n> or --all, not both')
  if (all) return 'all'
  if (at < 0) return DEFAULT_WINDOW_MONTHS
  const value = argv[at + 1] ?? ''
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`--months takes a whole number of months from 1, not "${value}"`)
  return Number(value)
}
