/**
 * Whether the research step works and applies now, and which selected stories it still owes
 * (`.context/story-research.md`, "The pipeline step"). The `research_stories` job's queue and the
 * publish gate share one definition, read from the run rows: a story is owed research while it is
 * `selected`, carries no applied research, and has no settled pipeline run. A completed or failed
 * pipeline run settles it, and so does one still `running` past `config.research.staleRunMinutes`
 * (a deploy cut the run off before any sweep marked it). Editors' runs settle nothing.
 *
 * The gate holds only while the step applies (`researchStepState().applies`: research switched on,
 * the job enabled, effective apply mode); in shadow mode stories publish on their schedule (owner
 * decision 2026-11-12). It holds a story at most `config.research.pipeline.maxWaitMinutes` after it
 * entered `selected`. Reads only.
 */
import { Prisma } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { pipelineMode } from './researchApply.js'
import { staleBefore, switchRefusal } from './researchRuns.js'

/** The research step's job; its row's `enabled` flag lets the step apply and the publish gate hold (a run of the disabled job is a shadow trial). */
export const RESEARCH_JOB = 'research_stories'

/**
 * `researches`: research is switched on (the key set, every step's model priced), so the job
 * researches, by hand too while it is disabled. `enabled`: the job's row is enabled. `applies`:
 * both, in effective apply mode (`pipelineMode()`); only then are verdicts applied and does the
 * publish gate hold.
 */
export interface ResearchStepState {
  researches: boolean
  enabled: boolean
  applies: boolean
}

export async function researchStepState(): Promise<ResearchStepState> {
  const researches = switchRefusal() === null
  const job = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_JOB }, select: { enabled: true } })
  const enabled = job?.enabled === true
  return { researches, enabled, applies: researches && enabled && pipelineMode().mode === 'apply' }
}

/** Selected, with no research applied (the public `researched` flag's column). */
const UNRESEARCHED: Prisma.StoryWhereInput = { status: 'selected', preResearch: { equals: Prisma.AnyNull } }

/** A pipeline run that settles its story: finished either way, or running past the stale limit. */
const settledRun = (now: Date): Prisma.StoryResearchRunWhereInput => ({
  trigger: 'pipeline',
  OR: [{ status: { in: ['completed', 'failed'] } }, { status: 'running', startedAt: { lt: staleBefore(now) } }],
})

/** Owed and not started: the job's queue leaves out a story with any pipeline run, a live one included. */
const QUEUED: Prisma.StoryWhereInput = { ...UNRESEARCHED, researchRuns: { none: { trigger: 'pipeline' } } }

/** The next selected stories the job researches, oldest crawled first. */
export async function nextToResearch(limit: number): Promise<string[]> {
  const rows = await prisma.story.findMany({ where: QUEUED, orderBy: [{ dateCrawled: 'asc' }, { id: 'asc' }], take: limit, select: { id: true } })
  return rows.map(r => r.id)
}

/**
 * The story's last write while the job still owes it its run, else null. Re-read before each story,
 * since an editor may have moved or researched it meanwhile; the apply is fenced on this `updatedAt`,
 * so an editor's edit or apply during the run is never overwritten.
 */
export async function owedStory(storyId: string): Promise<{ updatedAt: Date } | null> {
  return prisma.story.findFirst({ where: { ...QUEUED, id: storyId }, select: { updatedAt: true } })
}

/** The ids the publish job leaves for a later run: none unless the step applies, and none selected longer ago than the longest wait. */
export async function awaitingResearch(ids: string[], now: Date = new Date()): Promise<Set<string>> {
  if (ids.length === 0 || !(await researchStepState()).applies) return new Set()
  const waitingSince = new Date(now.getTime() - config.research.pipeline.maxWaitMinutes * 60_000)
  const rows = await prisma.story.findMany({
    where: { ...UNRESEARCHED, id: { in: ids }, selectedAt: { gte: waitingSince }, researchRuns: { none: settledRun(now) } },
    select: { id: true },
  })
  return new Set(rows.map(r => r.id))
}
