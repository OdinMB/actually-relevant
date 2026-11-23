/**
 * The overview step's switch and the stories it owes a link decision (`.context/overviews.md`, "The
 * job" and "How the switch stays off"). The step works only while its own eval gate is open
 * (`overviewGate.ts`) and research passes' gate is open too, and is enabled only while
 * `research_pass` is (the order of switches: overviews after research passes). A story is owed while
 * it is published, within the backfill window, has no active entry and no live settling `link`
 * decision (joined, founded, none, rejected; one not undone); which of them a run links, and when a
 * held, conflicting or failed one is linked again, is `overviewOwed.ts`'s. SELECT only.
 */
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { linkInputs, readInputs } from './overviewDecisions.js'
import { OVERVIEW_EVAL_GATE } from './overviewGate.js'
import { owedSlices, waitInForce, type OwedSlices, type OwedStory } from './overviewOwed.js'
import { recenterMayCome } from './overviewRecenter.js'
import { LINK_OUTCOMES, SETTLING_OUTCOMES } from './overviewTypes.js'
import { oneOf } from './storyContextRecords.js'
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
  if (passGate) return 'Overviews are switched off until research passes are on: their eval gate is still closed (.context/overviews.md, "Switching on")'
  return null
}

/** Why enabling the step conflicts with the research pass's switch: `research_pass` is disabled. Null when it is enabled. */
export async function overviewPassConflict(): Promise<string | null> {
  const pass = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_PASS_JOB }, select: { enabled: true } })
  return pass?.enabled ? null : `Overviews switch on only after research passes: enable ${RESEARCH_PASS_JOB} first (.context/overviews.md, "Switching on")`
}

let stepOn: { on: boolean; until: number } | null = null

/**
 * The step is switched on: both gates open and its job enabled. The gates are read first, so nothing
 * is queried while either is closed; the job's flag is kept `stepOnCacheSeconds`, so public reads add
 * no query each, and a change to it forgets it at once (`forgetOverviewStep`, from `updateJob`).
 */
export async function overviewStepOn(now: number = Date.now()): Promise<boolean> {
  if (overviewSwitchRefusal() !== null) return false
  if (stepOn && now < stepOn.until) return stepOn.on
  const job = await prisma.jobRun.findUnique({ where: { jobName: LINK_OVERVIEWS_JOB }, select: { enabled: true } })
  stepOn = { on: job?.enabled === true, until: now + config.overviews.stepOnCacheSeconds * 1000 }
  return stepOn.on
}

/** Forgets whether the step is on: the next read asks the jobs table. */
export function forgetOverviewStep(): void {
  stepOn = null
}

const DAY_MS = 86_400_000

/**
 * The stories one run links (`owedSlices`: the new backlog oldest first, the retries due, then the
 * night's), from every owed story of the backfill window with its link decisions: published, active
 * in no overview, with no live settling `link` decision. A held decision reads whether its overview is
 * still frozen; a waiting one whether its wait for that overview's re-center is still in force
 * (`waitInForce`, ADR-0078).
 */
export async function owedStories(now: Date = new Date(), options = config.overviews): Promise<OwedSlices> {
  const rows = await prisma.story.findMany({
    where: {
      status: 'published',
      datePublished: { gte: new Date(now.getTime() - options.backfillDays * DAY_MS) },
      overviewEntries: { none: { status: 'active' } },
      overviewDecisions: { none: { kind: 'link', undoneAt: null, outcome: { in: [...SETTLING_OUTCOMES] } } },
    },
    select: {
      id: true,
      datePublished: true,
      overviewDecisions: {
        where: { kind: 'link' },
        select: {
          outcome: true,
          undoneAt: true,
          createdAt: true,
          inputs: true,
          overview: {
            select: {
              frozen: true,
              status: true,
              automatedRecenters: true,
              recenteredAt: true,
              recenteredBy: true,
              recenterUndoneAt: true,
              recenterTriedAt: true,
            },
          },
        },
      },
    },
  })
  const owed: OwedStory[] = rows.flatMap(s => {
    const published = s.datePublished
    if (!published) return []
    return [
      {
        id: s.id,
        datePublished: published,
        attempts: s.overviewDecisions.map(d => {
          const at = readInputs(linkInputs, d.inputs)?.linkedAt ?? d.createdAt
          const o = d.overview
          return {
            outcome: oneOf(d.outcome, LINK_OUTCOMES, 'failed'),
            undone: d.undoneAt !== null,
            at,
            heldFrozen: d.outcome === 'held' && o?.frozen === true,
            waitInForce:
              d.outcome === 'waiting' &&
              o !== null &&
              waitInForce({ recenterable: recenterMayCome(o, now, options), triedAt: o.recenterTriedAt, linkedAt: at, datePublished: published }, now, options),
          }
        }),
      },
    ]
  })
  return owedSlices(owed, now, options)
}
