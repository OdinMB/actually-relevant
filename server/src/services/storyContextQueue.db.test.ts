/**
 * The context step's queue and the publish gate's hold for context, on PostgreSQL
 * (`storyContextQueue.ts`). A story's research and context runs are inserted as rows; nothing builds here.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createRunScope, runInScope } from '../lib/runUsage.js'
import { createCluster, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextRun, createResearchRun } from '../test/db/storyContext.js'
import { awaitingContext, nextForContext } from './storyContextQueue.js'
import { _setProcessStartedAt } from './storyContextStale.js'

const NOW = new Date('2026-11-16T01:00:00Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const FACTS = [{ id: 'S0', facts: [{ id: 'S0F1' }] }]

let feedId = ''

const selected = (selectedAt: Date = ago(10 * MINUTE)) => createStory({ feedId, status: 'selected', selectedAt })
const published = (daysAgo: number) => createStory({ feedId, status: 'published', datePublished: ago(daysAgo * DAY) })
const researched = async <S extends { id: string }>(story: Promise<S>): Promise<S> => {
  const s = await story
  await createResearchRun(s.id, FACTS)
  return s
}

const setJob = (enabled: boolean) =>
  prisma.jobRun.upsert({
    where: { jobName: 'build_story_context' },
    update: { enabled },
    create: { jobName: 'build_story_context', cronExpression: '30 1 * * *', enabled },
  })

describeDb('story context queue and publish gate (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
    // This process has been up since the day before NOW, so a run of the last hours is its own
    _setProcessStartedAt(ago(DAY))
    await setJob(true)
    feedId = (await createFeed((await createIssue()).id)).id
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    _setProcessStartedAt(null)
  })

  it('owes the selected stories about to publish first, oldest selected first, then the published ones of the lookback, oldest published first, with no limit', async () => {
    const publishedNewer = await researched(published(1))
    const publishedOlder = await researched(published(2.5))
    const selectedNewer = await researched(selected(ago(5 * MINUTE)))
    const selectedOlder = await researched(selected(ago(3 * DAY)))
    const primary = await researched(selected(ago(20 * MINUTE)))
    const duplicate = await researched(selected(ago(30 * MINUTE)))
    await createCluster([primary.id, duplicate.id], primary.id)

    // Not owed: past the lookback, no research facts, a failed research run, a context run of any outcome, another status
    await researched(published(3.5))
    const noFacts = await selected()
    await createResearchRun(noFacts.id, [{ id: 'S0', facts: [] }])
    const failedResearch = await selected()
    await createResearchRun(failedResearch.id, FACTS, { status: 'failed' })
    const settled = await researched(selected())
    await createContextRun(settled.id, { status: 'failed', outcome: 'technical' })
    const settledPublished = await researched(published(1))
    await createContextRun(settledPublished.id, { status: 'skipped', outcome: 'no-research' })
    await researched(createStory({ feedId, status: 'analyzed' }))

    expect(await nextForContext(NOW)).toEqual([selectedOlder.id, primary.id, selectedNewer.id, publishedOlder.id, publishedNewer.id])
  })

  it('holds a selected story it owes, and one whose context run is running within the stale limit, for at most the publish gate’s longest wait', async () => {
    const owed = await researched(selected())
    const running = await researched(selected())
    await createContextRun(running.id, {
      status: 'running',
      outcome: null,
      finishedAt: null,
      startedAt: ago((config.storyContext.staleRunMinutes - 5) * MINUTE),
    })
    const longAgo = await researched(selected(ago((config.research.pipeline.maxWaitMinutes + 1) * MINUTE)))
    const neverStamped = await researched(createStory({ feedId, status: 'selected', selectedAt: null }))

    expect(await awaitingContext([owed.id, running.id, longAgo.id, neverStamped.id], NOW)).toEqual(new Set([owed.id, running.id]))
  })

  it('lets through a story with a settled context run, one running past the stale limit, one without research facts, a duplicate, and another status', async () => {
    const ids: string[] = []
    for (const status of ['completed', 'failed', 'skipped'] as const) {
      const s = await researched(selected())
      await createContextRun(s.id, { status })
      ids.push(s.id)
    }
    const cutOff = await researched(selected())
    await createContextRun(cutOff.id, {
      status: 'running',
      outcome: null,
      finishedAt: null,
      startedAt: ago((config.storyContext.staleRunMinutes + 5) * MINUTE),
    })
    const unresearched = await selected()
    const primary = await researched(selected())
    const duplicate = await researched(selected())
    await createCluster([primary.id, duplicate.id], primary.id)
    const isPublished = await researched(published(0))

    expect(await awaitingContext([...ids, cutOff.id, unresearched.id, duplicate.id, isPublished.id], NOW)).toEqual(new Set())
    expect(await awaitingContext([primary.id], NOW)).toEqual(new Set([primary.id]))
  })

  it('lets through a story whose context run is running from before this process started: a restart cut it off', async () => {
    _setProcessStartedAt(ago(10 * MINUTE))
    const cutOff = await researched(selected())
    await createContextRun(cutOff.id, { status: 'running', outcome: null, finishedAt: null, startedAt: ago(30 * MINUTE) })
    const live = await researched(selected())
    await createContextRun(live.id, { status: 'running', outcome: null, finishedAt: null, startedAt: ago(5 * MINUTE) })

    expect(await awaitingContext([cutOff.id, live.id], NOW)).toEqual(new Set([live.id]))
  })

  it('holds nothing while the step’s job is disabled or web search is off', async () => {
    const owed = await researched(selected())
    expect(await awaitingContext([owed.id], NOW)).toEqual(new Set([owed.id]))

    await setJob(false)
    expect(await awaitingContext([owed.id], NOW)).toEqual(new Set())
    await prisma.jobRun.deleteMany({ where: { jobName: 'build_story_context' } })
    expect(await awaitingContext([owed.id], NOW)).toEqual(new Set())

    await setJob(true)
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(await awaitingContext([owed.id], NOW)).toEqual(new Set())
  })

  it('holds nothing when publishing runs in the daily edition: the step has just had its turn there, succeeded or failed', async () => {
    const owed = await researched(selected())
    const publishIn = (chain: string | null) => {
      const publish = () => runInScope(createRunScope({ jobName: 'publish_stories', flex: false }), () => awaitingContext([owed.id], NOW))
      return chain === null ? publish() : runInScope(createRunScope({ jobName: chain, flex: false, deadline: new Date(NOW.getTime() + DAY) }), publish)
    }
    expect(await publishIn('daily_edition_chain')).toEqual(new Set())
    // A run on its own (Run now on the Jobs page) waits, as one inside another job's run would
    expect(await publishIn(null)).toEqual(new Set([owed.id]))
    expect(await publishIn('intake_chain')).toEqual(new Set([owed.id]))
  })
})
