/**
 * The overview step's switch and the stories it owes a link decision (`.context/overviews.md`, "The
 * job" and "How the switch stays off"). The step works only while its own eval gate is open
 * (`overviewGate.ts`) and research passes' gate is open too, and is enabled only while
 * `research_pass` is (the order of switches: overviews after research passes). A story is owed while
 * it is published, within the backfill window, has no active entry and no live settling `link`
 * decision (joined, founded, none, rejected; one not undone): held, conflicting and failed stories are
 * retried. SELECT only.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { OVERVIEW_EVAL_GATE } from './overviewGate.js'
import { SETTLING_OUTCOMES } from './overviewTypes.js'
import { PASS_EVAL_GATE } from './researchPassGate.js'
import { RESEARCH_PASS_JOB } from './researchPassQueue.js'

/** The step's job; its row's `enabled` flag runs it in the daily edition. */
export const LINK_OVERVIEWS_JOB = 'link_overviews'

/**
 * Why the step may not run or be enabled now, whatever the settings: its eval gate, then research
 * passes' gate (overviews switch on only after research passes); null once both are open.
 */
export function overviewSwitchRefusal(gate: string | null = OVERVIEW_EVAL_GATE, passGate: string | null = PASS_EVAL_GATE): string | null {
  if (gate) return `Overviews are switched off: ${gate}`
  if (passGate) return 'Overviews are switched off until research passes are on: their eval gate is still closed (.context/overviews.md, "Order of switches")'
  return null
}

/** Why enabling the step conflicts with the research pass's switch: `research_pass` is disabled. Null when it is enabled. */
export async function overviewPassConflict(): Promise<string | null> {
  const pass = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_PASS_JOB }, select: { enabled: true } })
  return pass?.enabled ? null : `Overviews switch on only after research passes: enable ${RESEARCH_PASS_JOB} first (.context/overviews.md, "Order of switches")`
}

/** The step is switched on: both gates open and its job enabled. The gates are read first, so nothing is queried while either is closed. */
export async function overviewStepOn(): Promise<boolean> {
  if (overviewSwitchRefusal() !== null) return false
  const job = await prisma.jobRun.findUnique({ where: { jobName: LINK_OVERVIEWS_JOB }, select: { enabled: true } })
  return job?.enabled === true
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** The window's two parts: the night's stories (published within `nightHours`) and the older backlog the backfill takes. */
export function owedWindow(now: Date, options = config.overviews): { since: Date; nightStart: Date } {
  return { since: new Date(now.getTime() - options.backfillDays * DAY_MS), nightStart: new Date(now.getTime() - options.nightHours * HOUR_MS) }
}

const owedWhere = (from: Date, before: Date | null) => ({
  status: 'published' as const,
  datePublished: { gte: from, ...(before ? { lt: before } : {}) },
  overviewEntries: { none: { status: 'active' as const } },
  overviewDecisions: { none: { kind: 'link' as const, undoneAt: null, outcome: { in: [...SETTLING_OUTCOMES] } } },
})

export interface OwedSlices {
  /** Older owed stories, oldest first, at most `backfillPerRun`. */
  backlog: string[]
  /** The night's owed stories, oldest first, at most `perRun`. */
  night: string[]
  /** Every older owed story, for the summary's "backfill N of M". */
  backlogTotal: number
}

/** The stories one run links: the backlog's slice first, then the night's, each oldest first. */
export async function owedStories(now: Date = new Date(), options = config.overviews): Promise<OwedSlices> {
  const { since, nightStart } = owedWindow(now, options)
  const ids = (where: ReturnType<typeof owedWhere>, take: number) =>
    prisma.story.findMany({ where, orderBy: [{ datePublished: 'asc' }, { id: 'asc' }], take, select: { id: true } }).then(rows => rows.map(r => r.id))
  const [backlog, night, backlogTotal] = await Promise.all([
    ids(owedWhere(since, nightStart), options.backfillPerRun),
    ids(owedWhere(nightStart, null), options.perRun),
    prisma.story.count({ where: owedWhere(since, nightStart) }),
  ])
  return { backlog, night, backlogTotal }
}
