/**
 * Which stories the context step owes, and which of them the publish gate holds for their cards
 * (`.context/story-context.md`, "Which stories" and "The publish gate"): one definition for both, as
 * research's queue and gate share theirs (`researchQueue.ts`). A story is owed its context while it is
 * about to be published (`selected`, and unclustered or its cluster's primary: the stories the publish
 * job takes) or was published within `lookbackDays`, has a completed research run whose sources hold
 * facts, and has no context run yet: its first run settles it, whatever its outcome. Reads only.
 */
import { Prisma } from '@prisma/client'
import { config } from '../config.js'
import { chainOf } from '../jobs/chainDefinitions.js'
import prisma from '../lib/prisma.js'
import { enclosingRunJob } from '../lib/runUsage.js'
import { RUN_WITH_FACTS_SQL } from './storyContextInput.js'
import { staleBefore } from './storyContextStale.js'

/** The context step's job; its row's `enabled` flag runs it in its chain and lets the publish gate hold. */
export const STORY_CONTEXT_JOB = 'build_story_context'

/** The chain the step is a step of (the daily edition): in its run, publishing comes after the step. */
const STEP_CHAIN = chainOf(STORY_CONTEXT_JOB)

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** About to be published: selected, and unclustered or its cluster's primary (the publish job's rule, `publishChunk`). */
const TO_PUBLISH_SQL = Prisma.raw(`
  s.status = 'selected'
  AND (s.cluster_id IS NULL OR EXISTS (SELECT 1 FROM story_clusters k WHERE k.primary_story_id = s.id))`)

/** A completed research run of the story whose sources hold facts. */
const RESEARCHED_SQL = Prisma.sql`EXISTS (SELECT 1 FROM story_research_runs r WHERE r.story_id = s.id AND ${RUN_WITH_FACTS_SQL})`

/**
 * Every story the step owes, in the order it builds them: the stories about to be published first,
 * oldest selected first, then the published ones of the lookback, oldest published first. No limit:
 * a run is bounded by the night's stories.
 */
export async function nextForContext(now: Date = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - config.storyContext.lookbackDays * DAY_MS)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM stories s
    WHERE ((${TO_PUBLISH_SQL}) OR (s.status = 'published' AND s.date_published >= ${since}))
      AND NOT EXISTS (SELECT 1 FROM story_context_runs c WHERE c.story_id = s.id)
      AND ${RESEARCHED_SQL}
    ORDER BY s.status = 'published', CASE WHEN s.status = 'selected' THEN s.selected_at ELSE s.date_published END ASC NULLS FIRST, s.id ASC`
  return rows.map(r => r.id)
}

/** Whether the step builds cards now, so the gate may hold: web search on and the job enabled. */
async function stepWorks(): Promise<boolean> {
  if (!config.research.tavilyApiKey) return false
  const job = await prisma.jobRun.findUnique({ where: { jobName: STORY_CONTEXT_JOB }, select: { enabled: true } })
  return job?.enabled === true
}

/**
 * The ids a publish run on its own (Run now on the Jobs page) leaves for a later run while their cards
 * may still come: a selected story the step owes, with no settled context run (none, or one still
 * `running` that no restart cut off, `staleBefore`), selected less than the publish gate's longest wait ago
 * (`config.research.pipeline.maxWaitMinutes`, research's bound). None while the step's job is disabled
 * or web search is off, and **none in the daily edition's run**: there the step has just had its turn,
 * succeeded or failed, so a card it did not build is not coming that night, and the story goes out
 * without it rather than wait a day for the next edition.
 */
export async function awaitingContext(ids: string[], now: Date = new Date()): Promise<Set<string>> {
  if (ids.length === 0 || (STEP_CHAIN !== null && enclosingRunJob() === STEP_CHAIN) || !(await stepWorks())) return new Set()
  const waitingSince = new Date(now.getTime() - config.research.pipeline.maxWaitMinutes * MINUTE_MS)
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM stories s
    WHERE s.id = ANY(${ids}) AND ${TO_PUBLISH_SQL} AND s.selected_at >= ${waitingSince}
      AND ${RESEARCHED_SQL}
      AND NOT EXISTS (
        SELECT 1 FROM story_context_runs c
        WHERE c.story_id = s.id AND (c.status <> 'running' OR c.started_at < ${staleBefore(now)})
      )`
  return new Set(rows.map(r => r.id))
}
