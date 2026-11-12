/**
 * Which selected stories the research step still owes (`.context/story-research.md`, "The pipeline
 * step"). The `research_stories` job's queue and the publish gate share one definition, read from
 * the run rows: a story is owed research while it is `selected`, carries no applied research, and
 * has no settled pipeline run. A completed or failed pipeline run settles it, and so does one still
 * `running` past `config.research.staleRunMinutes`, so the gate's longest wait holds even when no
 * sweep has marked that row failed yet (a deploy cut the run off). Editors' runs settle nothing.
 * Reads only.
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { staleBefore, switchRefusal } from './researchRuns.js'

/** The research step's job; its row's `enabled` flag is the step's switch. */
export const RESEARCH_JOB = 'research_stories'

/** Whether the research step runs: its job row enabled, and research neither switched off by its key nor refused for an unpriced model. */
export async function researchPipelineOn(): Promise<boolean> {
  if (switchRefusal() !== null) return false
  const job = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_JOB }, select: { enabled: true } })
  return job?.enabled === true
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

/** Whether the job still owes this story its run: re-read before each story, since an editor may have moved or researched it meanwhile. */
export async function stillOwed(storyId: string): Promise<boolean> {
  return (await prisma.story.count({ where: { ...QUEUED, id: storyId } })) > 0
}

/** The ids the publish job leaves for a later run: none while the research step is off. */
export async function awaitingResearch(ids: string[], now: Date = new Date()): Promise<Set<string>> {
  if (ids.length === 0 || !(await researchPipelineOn())) return new Set()
  const rows = await prisma.story.findMany({
    where: { ...UNRESEARCHED, id: { in: ids }, researchRuns: { none: settledRun(now) } },
    select: { id: true },
  })
  return new Set(rows.map(r => r.id))
}
