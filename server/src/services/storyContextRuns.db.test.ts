import { it, expect, afterEach } from 'vitest'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { _setProcessStartedAt } from '../lib/runCutOff.js'
import { citingContextDeps as citingDeps, fakeContextDeps as deps } from '../test/contextDeps.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createResearchRun } from '../test/db/storyContext.js'
import {
  claimContextRun,
  executeContextRun,
  markInterruptedContextRuns,
  recordFailedRun,
  reopenFailedRun,
  runStoryContext,
  storeContextResult,
} from './storyContextRuns.js'

describeDb('story context runs', () => {
  useTestDatabase()
  afterEach(() => _setProcessStartedAt(null))

  const publishedStory = async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({
      feedId: feed.id,
      status: 'published',
      datePublished: new Date('2026-11-14T00:30:00Z'),
      title: 'Fires',
      summary: 'Fires burned.',
    })
    const research = await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }, { id: 'S0F2' }] }])
    return { story, research }
  }

  it("writes the run, every fact with its verdict and the kept boxes in one go, the run's costs apart", async () => {
    const { story, research } = await publishedStory()
    const out = (await runStoryContext(story.id, deps()))!
    expect(out).toMatchObject({ status: 'completed', outcome: 'built', boxes: 2, written: true })
    expect(out.tally.checked).toBeGreaterThan(0)

    const run = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: out.runId } })
    expect(run).toMatchObject({ storyId: story.id, researchRunId: research.id, status: 'completed', outcome: 'built', boxes: 2, tavilyCredits: 0, error: null })
    expect(run.modelUsd).toBeCloseTo(run.costUsd, 10)
    expect(run.finishedAt).not.toBeNull()
    expect(run.result).toMatchObject({ facts: { research: 2, supported: 2 }, responseNotFound: false })

    const facts = await prisma.contextFact.findMany({ where: { runId: run.id }, orderBy: { ref: 'asc' } })
    expect(facts.map(f => [f.ref, f.origin, f.verdict, f.status, f.model])).toEqual([
      ['S0F1', 'research', 'supported', 'unreviewed', 'model-structure'],
      ['S0F2', 'research', 'supported', 'unreviewed', 'model-structure'],
    ])
    expect(facts[0]).toMatchObject({ value: 2_880_000, unit: 'hectares', asOfPrecision: 'month', sourceKind: 'news-report' })
    expect(facts[0]!.asOf?.toISOString().slice(0, 10)).toBe('2026-11-01')

    const boxes = await prisma.contextBox.findMany({ where: { runId: run.id }, orderBy: { position: 'asc' } })
    expect(boxes.map(b => [b.position, b.type, b.place, b.model])).toEqual([
      [0, 'who_affected', null, 'model-write'],
      [1, 'compared', 'P1', 'model-write'],
    ])
    expect(boxes[0]!.visual).toEqual({ kind: 'tiles', tiles: [{ label: 'hectares burned', factIds: ['S0F1'] }] })
    expect(boxes[0]).toMatchObject({ asOfPrecision: 'month' })
  })

  it('records a failed run with what it spent and stores nothing else when a required step fails', async () => {
    const { story } = await publishedStory()
    const out = (await runStoryContext(story.id, deps({ failWrite: true })))!
    expect(out).toMatchObject({ status: 'failed', outcome: 'technical', tally: { checked: 0, failed: 0 } })
    const run = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: out.runId } })
    expect(run).toMatchObject({ status: 'failed', error: 'write: parse_failure' })
    expect(run.costUsd).toBeGreaterThan(0)
    expect(await prisma.contextFact.count()).toBe(0)
    expect(await prisma.contextBox.count()).toBe(0)
  })

  it('says whether a technical failure may pass on a later attempt', async () => {
    const run = async (d: ReturnType<typeof deps>) => runStoryContext((await publishedStory()).story.id, d)
    expect(await run(deps({ writeError: 'transient' }))).toMatchObject({ status: 'failed', outcome: 'technical', transient: true })
    expect(await run(deps({ writeError: 'lasting' }))).toMatchObject({ status: 'failed', transient: false })
    expect(await run(deps())).toMatchObject({ status: 'completed', transient: false })
  })

  it("builds a story's first run only: a story that has a run, an editor's made during the night included, is left as it is", async () => {
    const { story } = await publishedStory()
    const editors = await prisma.storyContextRun.create({ data: { storyId: story.id, status: 'completed', outcome: 'built', finishedAt: new Date() } })
    expect(await runStoryContext(story.id, deps())).toBeNull()
    expect(await prisma.storyContextRun.findMany({ where: { storyId: story.id }, select: { id: true } })).toEqual([{ id: editors.id }])
    // An editor's claim still starts another
    expect(await claimContextRun(story.id)).not.toBeNull()
  })

  it("tries a failed run again on its own row: only the second attempt's outcome is stored, the two attempts' costs added up", async () => {
    const { story } = await publishedStory()
    const first = (await runStoryContext(story.id, deps({ writeError: 'transient' })))!
    const firstRow = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: first.runId } })
    expect(firstRow.costUsd).toBeCloseTo(0.006, 10)

    const secondStart = new Date()
    const second = await runStoryContext(story.id, deps(), { runId: first.runId })
    expect(second).toMatchObject({ runId: first.runId, status: 'completed', outcome: 'built', boxes: 2, written: true })
    const row = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: first.runId } })
    expect(row).toMatchObject({ status: 'completed', outcome: 'built', error: null, boxes: 2 })
    // The row's start is the second attempt's
    expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(secondStart.getTime())
    // The record is the second attempt's; the costs are both attempts'
    const secondCalls = (row.result as { calls: { costUsd: number }[] }).calls
    expect(secondCalls.map(c => c.step)).toContain('write')
    expect(row.costUsd).toBeCloseTo(firstRow.costUsd + secondCalls.reduce((sum, c) => sum + c.costUsd, 0), 10)
    expect(row.modelUsd).toBeCloseTo(row.costUsd, 10)
    expect(await prisma.storyContextRun.count({ where: { storyId: story.id } })).toBe(1)
    expect(await prisma.contextBox.count({ where: { runId: first.runId } })).toBe(2)
  })

  it('leaves a run alone that is no longer a technical failure, and builds nothing for it', async () => {
    const { story } = await publishedStory()
    const done = (await runStoryContext(story.id, deps()))!
    const again = await runStoryContext(story.id, deps(), { runId: done.runId })
    expect(again).toMatchObject({ runId: done.runId, written: false, transient: false })
    expect(await prisma.contextBox.count({ where: { runId: done.runId } })).toBe(2)
  })

  it('records a skipped run for a story without research facts', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status: 'published', datePublished: new Date() })
    const out = (await runStoryContext(story.id, deps()))!
    expect(out).toMatchObject({ status: 'skipped', outcome: 'no-research' })
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: out.runId } })).toMatchObject({ status: 'skipped', outcome: 'no-research' })
  })

  it('marks a running run failed once it is stale or from before this process started, leaves one of this process, and writes nothing for a run marked meanwhile', async () => {
    const { story } = await publishedStory()
    const now = new Date('2026-11-16T03:00:00Z')
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)
    _setProcessStartedAt(minutesAgo(30))
    const stale = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: minutesAgo(config.storyContext.staleRunMinutes + 1) } })
    // Well within the limit, but a deploy or restart ended the process that ran it
    const beforeRestart = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: minutesAgo(60) } })
    const fresh = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: minutesAgo(10) } })
    expect(await markInterruptedContextRuns(now)).toBe(2)
    for (const { id } of [stale, beforeRestart]) {
      expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'failed',
        outcome: 'technical',
        error: 'interrupted: the server restarted during the run',
      })
    }
    expect((await prisma.storyContextRun.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('running')

    const result = { status: 'completed', outcome: 'none-kept', facts: [], boxes: [], writer: null, credits: 0, modelUsd: 0, record: {}, error: null } as never
    expect(await storeContextResult(stale.id, story.id, result)).toBe(false)
    expect((await prisma.storyContextRun.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('failed')
  })

  it('starts a second attempt’s clock anew, so the stale limit never cuts it off for its first attempt’s age', async () => {
    const { story } = await publishedStory()
    const firstStart = new Date(Date.now() - (config.storyContext.staleRunMinutes + 5) * 60_000)
    const failed = await prisma.storyContextRun.create({
      data: { storyId: story.id, status: 'failed', outcome: 'technical', startedAt: firstStart, finishedAt: new Date() },
    })
    expect(await reopenFailedRun(failed.id)).toBe(true)
    // Another claim's sweep, as the night's step makes before each story
    expect(await markInterruptedContextRuns()).toBe(0)
    const row = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: failed.id } })
    expect(row.status).toBe('running')
    expect(row.startedAt.getTime()).toBeGreaterThan(firstStart.getTime())
  })

  it('starts no run of a story while another of it is running, and tries a failed one again only then', async () => {
    const { story } = await publishedStory()
    const failed = await prisma.storyContextRun.create({ data: { storyId: story.id, status: 'failed', outcome: 'technical', finishedAt: new Date() } })
    const running = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: new Date() } })

    expect(await runStoryContext(story.id, deps())).toBeNull()
    expect(await runStoryContext(story.id, deps(), { runId: failed.id })).toMatchObject({ runId: failed.id, written: false })
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: 'failed' })
    expect(await prisma.storyContextRun.count({ where: { storyId: story.id } })).toBe(2)

    expect(await claimContextRun(story.id)).toBeNull()

    // Once the other run is over, both go ahead
    await prisma.storyContextRun.update({ where: { id: running.id }, data: { status: 'completed', outcome: 'built', finishedAt: new Date() } })
    expect(await runStoryContext(story.id, deps(), { runId: failed.id })).toMatchObject({ runId: failed.id, status: 'completed', written: true })
    expect(await claimContextRun(story.id)).not.toBeNull()
  })

  it("builds on the story's earlier run: its facts carried over, its research facts not structured again, the editor's choices kept by type", async () => {
    const { story } = await publishedStory()
    const first = (await runStoryContext(story.id, citingDeps()))!
    const [reach, compared] = await prisma.contextBox.findMany({ where: { runId: first.runId }, orderBy: { position: 'asc' } })
    await prisma.contextBox.update({ where: { id: reach!.id }, data: { status: 'demoted' } })
    await prisma.contextBox.update({ where: { id: compared!.id }, data: { place: null, placeByEditor: true } })

    // A second run is an editor's: the claim, then the run
    const steps: string[] = []
    const second = await executeContextRun(story.id, (await claimContextRun(story.id))!, citingDeps(steps), 1)
    expect(second).toMatchObject({ status: 'completed', outcome: 'built', boxes: 2, written: true })
    expect(second.runId).not.toBe(first.runId)
    expect(steps).not.toContain('structure')
    expect(steps).not.toContain('fact-check')

    const run = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: second.runId } })
    expect(run.result).toMatchObject({ facts: { research: 0, carried: 2 } })
    // The carried facts the boxes cite are stored with the new run, pointing at the first run's rows
    const firstFacts = new Set((await prisma.contextFact.findMany({ where: { runId: first.runId } })).map(f => f.id))
    const copies = await prisma.contextFact.findMany({ where: { runId: second.runId } })
    expect(copies).toHaveLength(2)
    expect(copies.every(f => f.reusedFromId !== null && firstFacts.has(f.reusedFromId))).toBe(true)

    const boxes = await prisma.contextBox.findMany({ where: { runId: second.runId }, orderBy: { position: 'asc' } })
    expect(boxes.map(b => [b.type, b.status, b.place, b.placeByEditor])).toEqual([
      ['who_affected', 'demoted', null, false],
      ['compared', 'unreviewed', null, true],
    ])
    // Nothing of the first run is deleted
    expect(await prisma.contextBox.count({ where: { runId: first.runId } })).toBe(2)
  })

  it('records a failed run for an error outside a run, which settles the story', async () => {
    const { story } = await publishedStory()
    const id = await recordFailedRun(story.id, 'unexpected error (Error)')
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'failed',
      outcome: 'technical',
      error: 'unexpected error (Error)',
    })
  })
})
