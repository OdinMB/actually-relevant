/** The overview report's text helpers, shared by its sections (`report.ts`, `contextReport.ts`). Pure. */
import { pct } from '../checks.js'
import type { Spread } from '../repeats.js'

export const usd = (v: number | null) => (v === null ? 'n/a' : `$${v.toFixed(v < 1 ? 4 : 2)}`)
/** Text safe in a table cell: no pipe, one line. */
export const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ')
export const quoted = (s: string) => `"${cell(s)}"`
export const metText = (met: boolean | null) => (met === null ? 'no verdicts' : met ? 'met' : 'not met')

/** A share's mean over the runs with its range and standard deviation. */
export const spreadText = (s: Spread | null) =>
  s ? `mean ${pct(s.mean)} (${pct(s.min)} to ${pct(s.max)}, SD ${s.sd === null ? 'n/a' : `${(s.sd * 100).toFixed(1)} points`})` : 'n/a'
