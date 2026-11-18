/**
 * The research pass step's state, the selected stories it still owes a pass, and the publish gate,
 * one definition read from the pass rows (`.context/research-passes.md`, "The job and the gate"). A
 * story is owed a pass while it is `selected`, carries no applied research, and has no pipeline pass;
 * a pipeline pass settles it once it is completed, skipped or failed, or still `running` past the
 * pass's stale rule (`passStaleBefore`: a restart cut it off). Editors' passes settle nothing.
 *
 * The step works only while its eval gate is open (`researchPassGate.ts`, closed until the owner
 * switches the step on, plan phase 6), the Tavily key is set and its job is enabled; the gate holds a story only
 * then, for at most `config.research.pipeline.maxWaitMinutes` after it was selected. SELECT only.
 */
import { Prisma } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { cutOffBefore } from '../lib/runCutOff.js'
import { PASS_EVAL_GATE } from './researchPassGate.js'
import { switchRefusal } from './researchRuns.js'

/** The step's job; its row's `enabled` flag runs it in the daily edition and lets the publish gate hold. */
export const RESEARCH_PASS_JOB = 'research_pass'

/** The old steps the pass replaces: switched off when it is switched on, and refused while it is on. */
export const REPLACED_JOBS: readonly string[] = ['research_stories', 'build_story_context']

/** Why the step does nothing while it works: its job is disabled (the button shows only while it is enabled). */
export const PASS_JOB_DISABLED = 'Research passes are switched off: the research_pass job is disabled on the Jobs page'

/**
 * Why no pass can run now, whatever the story, in editors' words, and why the job may not be enabled:
 * the eval gate, then research's switch (the key, priced models); null while the step works (its job
 * enabled or not).
 */
export function passSwitchRefusal(gate: string | null = PASS_EVAL_GATE): string | null {
  if (gate) return `Research passes are switched off: ${gate}`
  return switchRefusal()
}

/** `works`: the gate open and research switched on (the key set, every model priced). `enabled`: the job's row is enabled; passes run and the gate holds only with both. */
export interface PassStepState {
  works: boolean
  enabled: boolean
}

export async function passStepState(): Promise<PassStepState> {
  const works = passSwitchRefusal() === null
  const job = await prisma.jobRun.findUnique({ where: { jobName: RESEARCH_PASS_JOB }, select: { enabled: true } })
  return { works, enabled: job?.enabled === true }
}

/** Passes still `running` that started before this are cut off (`cutOffBefore`, `research.pass.staleRunMinutes`): marked failed, and they settle their story. */
export function passStaleBefore(now: Date): Date {
  return cutOffBefore(now, config.research.pass.staleRunMinutes)
}

/** Selected, with no research applied. */
const UNRESEARCHED: Prisma.StoryWhereInput = { status: 'selected', preResearch: { equals: Prisma.AnyNull } }

/** Owed and not started: the queue leaves out a story with any pipeline pass, a live one included. */
const QUEUED: Prisma.StoryWhereInput = { ...UNRESEARCHED, researchPasses: { none: { trigger: 'pipeline' } } }

/** A pipeline pass that settles its story: finished any way, or running past the stale rule. */
const settledPass = (now: Date): Prisma.ResearchPassWhereInput => ({
  trigger: 'pipeline',
  OR: [{ status: { in: ['completed', 'skipped', 'failed'] } }, { status: 'running', startedAt: { lt: passStaleBefore(now) } }],
})

/** The next selected stories the step gives a pass, oldest crawled first. */
export async function nextForPass(limit: number): Promise<string[]> {
  const rows = await prisma.story.findMany({ where: QUEUED, orderBy: [{ dateCrawled: 'asc' }, { id: 'asc' }], take: limit, select: { id: true } })
  return rows.map(r => r.id)
}

/** The story's last write while the step still owes it its pass, else null: re-read before each story, and the apply is fenced on it. */
export async function owedPassStory(storyId: string): Promise<{ updatedAt: Date } | null> {
  return prisma.story.findFirst({ where: { ...QUEUED, id: storyId }, select: { updatedAt: true } })
}

/** The ids the publish job leaves for a later run: none unless the step works and its job is enabled, and none selected longer ago than the longest wait. */
export async function awaitingPass(ids: string[], now: Date = new Date()): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { works, enabled } = await passStepState()
  if (!works || !enabled) return new Set()
  const waitingSince = new Date(now.getTime() - config.research.pipeline.maxWaitMinutes * 60_000)
  const rows = await prisma.story.findMany({
    where: { ...UNRESEARCHED, id: { in: ids }, selectedAt: { gte: waitingSince }, researchPasses: { none: settledPass(now) } },
    select: { id: true },
  })
  return new Set(rows.map(r => r.id))
}
