/**
 * What the research step still owes, on PostgreSQL: the job's queue and the publish gate, which share
 * one definition (`researchQueue.ts`). A story's runs are inserted as rows; nothing researches here.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'

const { awaitingResearch, nextToResearch, researchPipelineOn, stillOwed } = await import('./researchQueue.js')

const MINUTE_MS = 60_000
const NOW = new Date()
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS)

let feedId = ''

const selected = (dateCrawled = new Date()) => createStory({ feedId, status: 'selected', dateCrawled })

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

describeDb('research queue and publish gate (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    await setJob(true)
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is on while the job row is enabled and research is switched on, and off otherwise', async () => {
    expect(await researchPipelineOn()).toBe(true)
    await setJob(false)
    expect(await researchPipelineOn()).toBe(false)
    await setJob(true)
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await researchPipelineOn()).toBe(false)
    await prisma.jobRun.deleteMany({ where: { jobName: 'research_stories' } })
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    expect(await researchPipelineOn()).toBe(false)
  })

  it('keeps waiting a selected story with no run, one whose pipeline run is running within the stale limit, and one researched only by an editor', async () => {
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

  it('holds nothing while the job is disabled or research is switched off', async () => {
    const s = await selected()
    await setJob(false)
    expect(await awaitingResearch([s.id], NOW)).toEqual(new Set())
    await setJob(true)
    vi.stubEnv('TAVILY_API_KEY', '')
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

  it('tells whether one story is still owed, by the queue’s rule', async () => {
    const owed = await selected()
    const done = await selected()
    await runOf(done.id, { status: 'failed' })
    const published = await createStory({ feedId, status: 'published' })

    expect(await stillOwed(owed.id)).toBe(true)
    expect(await stillOwed(done.id)).toBe(false)
    expect(await stillOwed(published.id)).toBe(false)
    expect(await stillOwed('no-such-story')).toBe(false)
  })
})
