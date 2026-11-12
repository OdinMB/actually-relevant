/**
 * The research step's state, its queue and the publish gate, on PostgreSQL (`researchQueue.ts`). A
 * story's runs are inserted as rows; nothing researches here.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'

// The research step's mode and the owner's gate are read at startup, so the tests set them through the config
const switches = vi.hoisted(() => ({ mode: 'apply' as 'shadow' | 'apply', applyEnabled: true }))
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  Object.defineProperty(actual.config.research, 'applyEnabled', { get: () => switches.applyEnabled })
  Object.defineProperty(actual.config.research.pipeline, 'mode', { get: () => switches.mode })
  return actual
})

const { awaitingResearch, nextToResearch, owedStory, researchStepState } = await import('./researchQueue.js')

const MINUTE_MS = 60_000
const NOW = new Date()
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS)

let feedId = ''

const selected = (dateCrawled = new Date(), selectedAt: Date | null = NOW) => createStory({ feedId, status: 'selected', dateCrawled, selectedAt })

async function runOf(storyId: string, data: { trigger?: 'editor' | 'pipeline'; status: 'running' | 'completed' | 'failed'; startedAt?: Date }) {
  await prisma.storyResearchRun.create({
    data: { storyId, trigger: data.trigger ?? 'pipeline', status: data.status, costUsd: 0.05, startedAt: data.startedAt ?? NOW },
  })
}

const setJob = (enabled: boolean) =>
  prisma.jobRun.upsert({
    where: { jobName: 'research_stories' },
    update: { enabled },
    create: { jobName: 'research_stories', cronExpression: '15 * * * *', enabled },
  })

describeDb('research step state, queue and publish gate (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    switches.mode = 'apply'
    switches.applyEnabled = true
    await setJob(true)
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('researches while research is switched on, and applies only with the job enabled in effective apply mode', async () => {
    expect(await researchStepState()).toEqual({ researches: true, enabled: true, applies: true })

    switches.mode = 'shadow'
    expect(await researchStepState()).toEqual({ researches: true, enabled: true, applies: false })
    switches.mode = 'apply'
    switches.applyEnabled = false
    expect(await researchStepState()).toEqual({ researches: true, enabled: true, applies: false })
    switches.applyEnabled = true

    // A disabled job still researches when run by hand, in shadow
    await setJob(false)
    expect(await researchStepState()).toEqual({ researches: true, enabled: false, applies: false })
    await prisma.jobRun.deleteMany({ where: { jobName: 'research_stories' } })
    expect(await researchStepState()).toEqual({ researches: true, enabled: false, applies: false })

    await setJob(true)
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await researchStepState()).toEqual({ researches: false, enabled: true, applies: false })
  })

  it('in apply mode keeps waiting a selected story with no run, one whose pipeline run is running within the stale limit, and one researched only by an editor', async () => {
    const none = await selected()
    const running = await selected()
    await runOf(running.id, { status: 'running', startedAt: ago(config.research.staleRunMinutes - 5) })
    const byEditor = await selected()
    await runOf(byEditor.id, { trigger: 'editor', status: 'completed' })

    expect(await awaitingResearch([none.id, running.id, byEditor.id], NOW)).toEqual(new Set([none.id, running.id, byEditor.id]))
  })

  it('lets through a story with a completed or failed pipeline run, one running past the stale limit, applied research, or another status', async () => {
    const completed = await selected()
    await runOf(completed.id, { status: 'completed' })
    const failed = await selected()
    await runOf(failed.id, { status: 'failed' })
    const cutOff = await selected()
    await runOf(cutOff.id, { status: 'running', startedAt: ago(config.research.staleRunMinutes + 5) })
    const applied = await selected()
    await prisma.story.update({ where: { id: applied.id }, data: { preResearch: { title: 'single' } as Prisma.InputJsonObject } })
    const analyzed = await createStory({ feedId, status: 'analyzed' })

    expect(await awaitingResearch([completed.id, failed.id, cutOff.id, applied.id, analyzed.id], NOW)).toEqual(new Set())
  })

  it('lets through a story selected longer ago than the longest wait, or with no record of when, whatever its runs', async () => {
    const { maxWaitMinutes } = config.research.pipeline
    const recent = await selected(new Date(), ago(maxWaitMinutes - 5))
    const waitedLong = await selected(new Date(), ago(maxWaitMinutes + 5))
    const waitedLongRunning = await selected(new Date(), ago(maxWaitMinutes + 5))
    await runOf(waitedLongRunning.id, { status: 'running' })
    const unknown = await selected(new Date(), null)

    expect(await awaitingResearch([recent.id, waitedLong.id, waitedLongRunning.id, unknown.id], NOW)).toEqual(new Set([recent.id]))
  })

  it.each([
    ['in shadow mode (owner decision 2026-11-12)', () => (switches.mode = 'shadow')],
    ['while apply mode is held back by the owner’s gate', () => (switches.applyEnabled = false)],
    ['while the job is disabled', () => setJob(false)],
    ['while research is switched off', () => vi.stubEnv('TAVILY_API_KEY', '')],
  ])('holds nothing %s', async (_name, arrange) => {
    const s = await selected()
    await arrange()
    expect(await awaitingResearch([s.id], NOW)).toEqual(new Set())
  })

  it('queues the selected stories without applied research and without any pipeline run, oldest crawled first, up to the limit', async () => {
    const oldest = await selected(ago(300))
    const middle = await selected(ago(200))
    const newest = await selected(ago(100))
    const running = await selected(ago(400))
    await runOf(running.id, { status: 'running' })
    const cutOff = await selected(ago(500))
    await runOf(cutOff.id, { status: 'running', startedAt: ago(config.research.staleRunMinutes + 5) })
    const byEditor = await selected(ago(250))
    await runOf(byEditor.id, { trigger: 'editor', status: 'completed' })
    await createStory({ feedId, status: 'analyzed', dateCrawled: ago(600) })

    expect(await nextToResearch(10)).toEqual([oldest.id, byEditor.id, middle.id, newest.id])
    expect(await nextToResearch(2)).toEqual([oldest.id, byEditor.id])
  })

  it('gives a story still owed by the queue’s rule with its last write, which the apply is fenced on, and nothing for any other', async () => {
    const owed = await selected()
    const done = await selected()
    await runOf(done.id, { status: 'failed' })
    const published = await createStory({ feedId, status: 'published' })

    expect(await owedStory(owed.id)).toEqual({ updatedAt: (await prisma.story.findUniqueOrThrow({ where: { id: owed.id } })).updatedAt })
    expect(await owedStory(done.id)).toBeNull()
    expect(await owedStory(published.id)).toBeNull()
    expect(await owedStory('no-such-story')).toBeNull()
  })
})
