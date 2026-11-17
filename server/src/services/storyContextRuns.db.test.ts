import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { ZERO_USAGE } from '../lib/llmUsage.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createResearchRun } from '../test/db/storyContext.js'
import type { ContextDeps } from './storyContextPipeline.js'
import { markInterruptedContextRuns, recordFailedRun, runStoryContext, storeContextResult } from './storyContextRuns.js'

const fields = {
  value: null,
  valueHigh: null,
  unit: '',
  approx: 'exact',
  provisional: false,
  counted: '',
  place: '',
  asOf: '',
  credited: '',
  creditedKind: 'none',
  validity: 'fixed',
}

/** Answers every step: research's facts structured (S0F1 with a figure), nothing missing, all supported, one box and the figures. */
function deps(options: { failWrite?: boolean } = {}): ContextDeps {
  return {
    async call(step, _schema, prompt) {
      let parsed: unknown
      if (step === 'structure')
        parsed = {
          facts: [...prompt.matchAll(/<FACT id="([^"]+)"/g)].map(m => ({
            id: m[1],
            ...fields,
            ...(m[1] === 'S0F1' ? { value: 2_880_000, unit: 'hectares', counted: 'area burned in Indonesia', asOf: '2026-11' } : {}),
          })),
        }
      else if (step === 'gap-list')
        parsed = {
          slots: [{ slot: 'response', needed: true, covered: 'yes' }],
          responseInStory: '',
          responseSearches: { action: '', elsewhere: '' },
          searches: [],
        }
      else if (step === 'write')
        parsed = options.failWrite
          ? null
          : {
              figures: { heading: 'In numbers', teaser: 'The figures', tiles: [{ label: 'hectares burned', factIds: ['S0F1'] }] },
              boxes: [
                {
                  slot: 'compared',
                  heading: 'Twice the usual',
                  teaser: 'Twice the usual area',
                  place: 'P1',
                  sentences: [{ text: 'It is twice the usual.', factIds: ['S0F2'] }],
                  visual: { kind: 'none', tiles: [], measure: '', unit: '', points: [], apart: null },
                },
              ],
            }
      else
        parsed = {
          items: [...prompt.matchAll(/<ITEM number="(\d+)"/g)].map(m => ({
            number: Number(m[1]),
            supported: true,
            problem: '',
            key: false,
            copiedSentence: '',
            followsSource: '',
          })),
        }
      return { parsed: parsed as never, outcome: parsed === null ? 'parse_failure' : 'ok', usage: ZERO_USAGE, costUsd: 0.002, model: `model-${step}` }
    },
    search: async () => ({ results: [], credits: 0, cached: false }),
  }
}

describeDb('story context runs', () => {
  useTestDatabase()

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
    const out = await runStoryContext(story.id, deps())
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
      [0, 'figures', null, 'model-write'],
      [1, 'compared', 'P1', 'model-write'],
    ])
    expect(boxes[0]!.visual).toEqual({ kind: 'tiles', tiles: [{ label: 'hectares burned', factIds: ['S0F1'] }] })
    expect(boxes[0]).toMatchObject({ asOfPrecision: 'month' })
  })

  it('records a failed run with what it spent and stores nothing else when a required step fails', async () => {
    const { story } = await publishedStory()
    const out = await runStoryContext(story.id, deps({ failWrite: true }))
    expect(out).toMatchObject({ status: 'failed', outcome: 'technical', tally: { checked: 0, failed: 0 } })
    const run = await prisma.storyContextRun.findUniqueOrThrow({ where: { id: out.runId } })
    expect(run).toMatchObject({ status: 'failed', error: 'write: parse_failure' })
    expect(run.costUsd).toBeGreaterThan(0)
    expect(await prisma.contextFact.count()).toBe(0)
    expect(await prisma.contextBox.count()).toBe(0)
  })

  it('records a skipped run for a story without research facts', async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const story = await createStory({ feedId: feed.id, status: 'published', datePublished: new Date() })
    const out = await runStoryContext(story.id, deps())
    expect(out).toMatchObject({ status: 'skipped', outcome: 'no-research' })
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: out.runId } })).toMatchObject({ status: 'skipped', outcome: 'no-research' })
  })

  it('marks a stale running run failed, leaves a fresh one, and writes nothing for a run marked meanwhile', async () => {
    const { story } = await publishedStory()
    const now = new Date('2026-11-16T03:00:00Z')
    const stale = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: new Date(now.getTime() - 121 * 60_000) } })
    const fresh = await prisma.storyContextRun.create({ data: { storyId: story.id, startedAt: new Date(now.getTime() - 60 * 60_000) } })
    expect(await markInterruptedContextRuns(now)).toBe(1)
    expect(await prisma.storyContextRun.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({
      status: 'failed',
      outcome: 'technical',
      error: 'interrupted: the server restarted during the run',
    })
    expect((await prisma.storyContextRun.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('running')

    const result = { status: 'completed', outcome: 'none-kept', facts: [], boxes: [], writer: null, credits: 0, modelUsd: 0, record: {}, error: null } as never
    expect(await storeContextResult(stale.id, story.id, result)).toBe(false)
    expect((await prisma.storyContextRun.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('failed')
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
