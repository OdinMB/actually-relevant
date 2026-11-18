/**
 * The month's spend per job, research started by an editor and in total, the month at this pace, the
 * warning levels and their once-a-month notices (`.context/scheduler.md`, "Spending"). Each job's
 * spend comes from `job_month_spend`, which every finished run adds to (`finishJobRun`); research an
 * editor started runs outside any job, so its spend comes from its own `story_research_runs` rows
 * (the research step's runs are already in its job's spend). Nothing stops on cost: a level only
 * records a notice. `paceUsd` and `warningsDue` are pure.
 */
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { notify } from '../lib/notify.js'
import { CHAINS, isChain } from '../jobs/chainDefinitions.js'
import { jobDisplayName } from '../jobs/jobDisplayName.js'
import { MODEL_JOBS } from '../jobs/modelJobs.js'
import { BadRequestError } from '../utils/errors.js'
import { monthToDateChars, utcMonthStart } from './podcastGuards.js'

/** The scope of research started by an editor, which runs outside any job. */
export const EDITOR_RESEARCH = 'editor_research'
/** The scope of the total: every job and research started by an editor. */
export const ALL_SPEND = 'all'

export type SpendWarningKind = 'passed' | 'on_pace'

export interface SpendTotals {
  /** Model calls: the total less the web searches. */
  aiUsd: number
  searchUsd: number
  totalUsd: number
}

export interface SpendingRow {
  /** A job's name, `editor_research` or `all`. */
  scope: string
  thisMonth: SpendTotals
  /** This month's total at the pace so far (`paceUsd`). */
  paceUsd: number
  /** The totals of the month before and of the one before that. */
  previousUsd: [number, number]
  levelUsd: number | null
  /** The level is passed, or the month is heading past it at this pace; null without a level or under it. */
  warning: SpendWarningKind | null
}

export interface SpendingGroup {
  /** The chain whose steps the rows are, in the chain's order; null for the jobs on their own schedules and editor research. */
  chain: string | null
  rows: SpendingRow[]
}

export interface SpendingOverview {
  /** This UTC month, `YYYY-MM`. */
  month: string
  /** The month before and the one before that, `YYYY-MM`. */
  previousMonths: [string, string]
  /** Today's day of the UTC month and the month's length. */
  day: number
  daysInMonth: number
  groups: SpendingGroup[]
  total: SpendingRow
  /** The podcast's voices are on a plan, not billed per use: characters used this month and the cap. */
  voices: { usedChars: number; capChars: number }
}

const ZERO: SpendTotals = { aiUsd: 0, searchUsd: 0, totalUsd: 0 }

const addTotals = (a: SpendTotals, b: SpendTotals): SpendTotals => ({
  aiUsd: a.aiUsd + b.aiUsd,
  searchUsd: a.searchUsd + b.searchUsd,
  totalUsd: a.totalUsd + b.totalUsd,
})

const monthKey = (monthStart: Date) => monthStart.toISOString().slice(0, 7)

/** The first moment of the UTC month `back` months before `now`'s. */
const monthsBefore = (now: Date, back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))

/** Today's day of the UTC month and the month's number of days. */
function monthDays(now: Date): { day: number; daysInMonth: number } {
  return { day: now.getUTCDate(), daysInMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate() }
}

/** The month's spend at the pace so far: spend × days in the month ÷ days so far, today counted. */
export function paceUsd(spentUsd: number, now: Date): number {
  const { day, daysInMonth } = monthDays(now)
  return (spentUsd * daysInMonth) / day
}

/** Past the level, or heading past it at this pace from `config.spending.paceFromDay` on; null without a level or under it. */
function warningOf(spentUsd: number, levelUsd: number | null, now: Date): SpendWarningKind | null {
  if (levelUsd === null) return null
  if (spentUsd > levelUsd) return 'passed'
  if (now.getUTCDate() >= config.spending.paceFromDay && paceUsd(spentUsd, now) > levelUsd) return 'on_pace'
  return null
}

export interface ScopeSpend {
  scope: string
  /** This month's total so far. */
  spentUsd: number
  levelUsd: number | null
}

export interface DueWarning {
  scope: string
  kind: SpendWarningKind
  spentUsd: number
  paceUsd: number
  levelUsd: number
}

/** The scopes whose level is passed, or which are heading past it at this pace, in the order given. */
export function warningsDue(scopes: ScopeSpend[], now: Date): DueWarning[] {
  return scopes.flatMap(({ scope, spentUsd, levelUsd }) => {
    const kind = warningOf(spentUsd, levelUsd, now)
    return kind && levelUsd !== null ? [{ scope, kind, spentUsd, paceUsd: paceUsd(spentUsd, now), levelUsd }] : []
  })
}

/** Each scope's spend per month (`YYYY-MM`) from `from` on: every job but a chain, and research started by an editor. */
async function spendByScope(from: Date): Promise<Map<string, Map<string, SpendTotals>>> {
  const [jobMonths, editorRuns] = await Promise.all([
    prisma.jobMonthSpend.findMany({ where: { month: { gte: from } } }),
    prisma.storyResearchRun.findMany({
      where: { trigger: 'editor', startedAt: { gte: from } },
      select: { startedAt: true, costUsd: true, tavilyCredits: true },
    }),
  ])
  const byScope = new Map<string, Map<string, SpendTotals>>()
  const add = (scope: string, month: string, totals: SpendTotals) => {
    const months = byScope.get(scope) ?? new Map<string, SpendTotals>()
    months.set(month, addTotals(months.get(month) ?? ZERO, totals))
    byScope.set(scope, months)
  }
  // A chain's run adds nothing to the table (its steps' runs carry its spend); a row left from before that would count twice
  for (const row of jobMonths.filter(r => !isChain(r.jobName))) {
    add(row.jobName, monthKey(row.month), { aiUsd: row.costUsd - row.searchUsd, searchUsd: row.searchUsd, totalUsd: row.costUsd })
  }
  // The run's stored cost: its standard-price upper bound, or its reservation while it runs (as research's own cap counts it)
  for (const run of editorRuns) {
    const searchUsd = run.tavilyCredits * config.research.tavilyUsdPerCredit
    add(EDITOR_RESEARCH, monthKey(utcMonthStart(run.startedAt)), { aiUsd: run.costUsd - searchUsd, searchUsd, totalUsd: run.costUsd })
  }
  return byScope
}

async function levelsByScope(scopes?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.spendWarning.findMany(scopes ? { where: { scope: { in: scopes } } } : undefined)
  return new Map(rows.map(row => [row.scope, row.levelUsd]))
}

/**
 * This UTC month and the two before it: each job that uses models (with nothing spent, a dash on the
 * card) or spent anything in them, grouped as the Jobs page groups jobs (each chain's steps in its
 * order, then the jobs on their own schedules); research started by an editor; the total; the pace;
 * each level and whether it is passed or heading past at this pace; the podcast's voice characters.
 */
export async function getSpendingOverview(now: Date = new Date()): Promise<SpendingOverview> {
  const keys = [0, 1, 2].map(back => monthKey(monthsBefore(now, back))) as [string, string, string]
  const [spend, levels, usedChars] = await Promise.all([spendByScope(monthsBefore(now, 2)), levelsByScope(), monthToDateChars(now)])

  const monthOf = (scope: string, key: string) => spend.get(scope)?.get(key) ?? ZERO
  const toRow = (scope: string, months: [SpendTotals, SpendTotals, SpendTotals]): SpendingRow => {
    const levelUsd = levels.get(scope) ?? null
    return {
      scope,
      thisMonth: months[0],
      paceUsd: paceUsd(months[0].totalUsd, now),
      previousUsd: [months[1].totalUsd, months[2].totalUsd],
      levelUsd,
      warning: warningOf(months[0].totalUsd, levelUsd, now),
    }
  }
  const scopeMonths = (scope: string) => keys.map(key => monthOf(scope, key)) as [SpendTotals, SpendTotals, SpendTotals]
  const rowOf = (scope: string) => toRow(scope, scopeMonths(scope))

  const spentJobs = [...spend.keys()].filter(scope => scope !== EDITOR_RESEARCH && keys.some(key => monthOf(scope, key).totalUsd > 0))
  const listed = new Set([...MODEL_JOBS, ...spentJobs])
  const stepsOfChains = new Set(Object.values(CHAINS).flat())
  const groups: SpendingGroup[] = Object.entries(CHAINS)
    .map(([chain, steps]) => ({ chain, rows: steps.filter(step => listed.has(step)).map(rowOf) }))
    .filter(group => group.rows.length > 0)
  const standalone = [...listed].filter(job => !stepsOfChains.has(job) && !isChain(job)).sort()
  groups.push({ chain: null, rows: [rowOf(EDITOR_RESEARCH), ...standalone.map(rowOf)] })

  const totalMonths = keys.map(key => groups.flatMap(g => g.rows).reduce((sum, row) => addTotals(sum, monthOf(row.scope, key)), ZERO)) as [
    SpendTotals,
    SpendTotals,
    SpendTotals,
  ]
  const { day, daysInMonth } = monthDays(now)
  return {
    month: keys[0],
    previousMonths: [keys[1], keys[2]],
    day,
    daysInMonth,
    groups,
    total: toRow(ALL_SPEND, totalMonths),
    voices: { usedChars, capChars: config.podcast.monthlyTtsCharCap },
  }
}

/**
 * Whether a level can be set for `scope`: the total, research started by an editor, a job that uses
 * models, or any other job with a row (one that spends on embeddings). Never a chain: its steps carry
 * its spend. A BadRequestError otherwise.
 */
async function assertSpendScope(scope: string): Promise<void> {
  if (scope === ALL_SPEND || scope === EDITOR_RESEARCH || MODEL_JOBS.has(scope)) return
  if (!isChain(scope) && (await prisma.jobRun.count({ where: { jobName: scope } })) > 0) return
  throw new BadRequestError(`No spending is counted for ${scope}`)
}

/** Set the scope's monthly warning level in whole USD, or clear it with null. */
export async function setSpendWarning(scope: string, levelUsd: number | null): Promise<void> {
  await assertSpendScope(scope)
  if (levelUsd === null) await prisma.spendWarning.deleteMany({ where: { scope } })
  else await prisma.spendWarning.upsert({ where: { scope }, create: { scope, levelUsd }, update: { levelUsd } })
}

const scopeName = (scope: string) => (scope === ALL_SPEND ? 'Spending' : scope === EDITOR_RESEARCH ? 'Research started by an editor' : jobDisplayName(scope))

const usd = (value: number) => `$${value.toFixed(2)}`

function spendNotice(due: DueWarning, totals: SpendTotals, now: Date) {
  const name = scopeName(due.scope)
  const since = utcMonthStart(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const who = due.scope === ALL_SPEND ? 'All jobs together have' : 'It has'
  return {
    source: 'jobs' as const,
    severity: 'warning' as const,
    title: due.kind === 'passed' ? `${name} passed $${due.levelUsd} this month` : `${name} is on pace to pass $${due.levelUsd} this month`,
    message:
      `${who} spent ${usd(totals.totalUsd)} since ${since} (AI ${usd(totals.aiUsd)}, web search ${usd(totals.searchUsd)}). ` +
      `At this pace the month ends near $${Math.round(due.paceUsd)}. Nothing stops on cost; this notice comes once a month.`,
    link: '/admin/spending',
    // One key per kind, so a pace notice early in the month never keeps the passed notice out
    dedupeKey: `spend-warn:${due.scope}:${monthKey(utcMonthStart(now))}:${due.kind === 'passed' ? 'passed' : 'pace'}`,
  }
}

/**
 * After a job's run (`finishJobRun`) or an editor's research run (`editor_research`): compare the
 * scope's month and the total with their levels, and record a warning notice for a level passed or
 * heading past at this pace: at most one of each kind per scope and month (insert-only, so a later
 * pass of the same kind in the month records nothing). Callers log a failure; it never fails the run.
 */
export async function checkSpendWarnings(scope: string, now: Date = new Date()): Promise<void> {
  const scopes = [...new Set([scope, ALL_SPEND])]
  const levels = await levelsByScope(scopes)
  if (levels.size === 0) return

  const key = monthKey(utcMonthStart(now))
  const spend = await spendByScope(utcMonthStart(now))
  const thisMonth = (s: string) =>
    s === ALL_SPEND ? [...spend.values()].reduce((sum, months) => addTotals(sum, months.get(key) ?? ZERO), ZERO) : (spend.get(s)?.get(key) ?? ZERO)
  const due = warningsDue(
    scopes.map(s => ({ scope: s, spentUsd: thisMonth(s).totalUsd, levelUsd: levels.get(s) ?? null })),
    now,
  )
  for (const warning of due) await notify(spendNotice(warning, thisMonth(warning.scope), now), { reopen: false })
}
