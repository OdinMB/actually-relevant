import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextFact, createContextRun, createResearchRun } from '../test/db/storyContext.js'
import { contextEligibility, loadContextInput, loadEarlierWork } from './storyContextInput.js'
import { RESPONSE_ANGLES } from './storyContextPipeline.js'
import { factKey } from './storyContextRecords.js'

const NOW = new Date('2026-11-16T01:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

describeDb('story context input', () => {
  useTestDatabase()

  const setup = async () => {
    const issue = await createIssue()
    const feed = await createFeed(issue.id)
    const published = (days: number, data: Parameters<typeof createStory>[0] extends infer D ? Partial<D> : never = {}) =>
      createStory({ feedId: feed.id, status: 'published', datePublished: ago(days), title: 'A story', summary: 'Its summary.', ...data })
    return { feed, published }
  }

  it("loads the story's text, its newest research run with facts, and the earlier stories' current supported facts", async () => {
    const { published } = await setup()
    const earlier = await published(10)
    const story = await published(1, { summary: 'One paragraph.' })
    await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { startedAt: ago(2), earlier: [earlier.id] })
    const newest = await createResearchRun(
      story.id,
      [
        { id: 'S0', url: story.sourceUrl, facts: [{ id: 'S0F1' }, { id: 'S0F2' }] },
        { id: 'S3', facts: [{ id: 'S3F1' }] },
      ],
      {
        startedAt: ago(1),
        earlier: [earlier.id],
      },
    )
    await createResearchRun(story.id, [{ id: 'S0', facts: [] }], { startedAt: ago(0.5) })

    const run = await createContextRun(earlier.id)
    await createContextFact(earlier.id, run.id, { ref: 'S2F1', validity: 'fixed', asOf: new Date('2015-01-01'), asOfPrecision: 'year' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F2', validity: 'fast', asOf: new Date('2026-11-10'), asOfPrecision: 'day' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F3', validity: 'fast', asOf: new Date('2026-10-01'), asOfPrecision: 'day' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F4', verdict: 'rejected' })
    await createContextFact(earlier.id, run.id, { ref: 'S2F5', status: 'demoted' })

    const input = await loadContextInput(prisma, story.id)
    expect(input).toMatchObject({
      storyId: story.id,
      title: 'A story',
      storyDay: ago(1).toISOString().slice(0, 10),
      researchRunId: newest.id,
      layout: { paragraphs: [{ id: 'P1', text: 'One paragraph.', sourceUrls: [story.sourceUrl] }] },
    })
    expect(input!.sources.map(s => [s.id, s.facts.map(f => f.id)])).toEqual([
      ['S0', ['S0F1', 'S0F2']],
      ['S3', ['S3F1']],
    ])
    expect(input!.reusable.map(f => [f.ref, f.asOf])).toEqual([
      ['S2F2', '2026-11-10'],
      ['S2F1', '2015'],
    ])
    expect(input!.reusable[0]).toMatchObject({ verdict: 'supported', source: { id: 'S2', outlet: 'Outlet S2F2', date: '2026-11-12' } })
  })

  it('offers a fact once when an earlier story already carried it as a reused fact', async () => {
    const { published } = await setup()
    const first = await published(10)
    const second = await published(5)
    const story = await published(1)
    await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { earlier: [first.id, second.id] })
    const original = await createContextFact(first.id, (await createContextRun(first.id)).id, { ref: 'S2F1', validity: 'fixed' })
    const copy = await createContextFact(second.id, (await createContextRun(second.id)).id, { ref: 'S3F1', validity: 'fixed', reusedFromId: original.id })
    const other = await createContextFact(second.id, copy.runId, { ref: 'S3F2', validity: 'fixed' })

    const input = await loadContextInput(prisma, story.id)
    expect(input!.reusable.map(f => f.id).sort()).toEqual([copy.id, other.id].sort())
  })

  it('loads a selected story about to be published, its day the run’s', async () => {
    const { feed } = await setup()
    const story = await createStory({ feedId: feed.id, status: 'selected', title: 'A story', summary: 'Its summary.' })
    const run = await createResearchRun(story.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    expect(await loadContextInput(prisma, story.id, NOW)).toMatchObject({ storyId: story.id, storyDay: '2026-11-16', researchRunId: run.id })
  })

  it('loads nothing for a story neither selected nor published, or without research facts', async () => {
    const { feed, published } = await setup()
    const analyzed = await createStory({ feedId: feed.id, status: 'analyzed' })
    await createResearchRun(analyzed.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    const bare = await published(1)
    await createResearchRun(bare.id, [{ id: 'S0', facts: [] }])
    expect(await loadContextInput(prisma, analyzed.id)).toBeNull()
    expect(await loadContextInput(prisma, bare.id)).toBeNull()
  })

  it('says whether a story can have context gathered: its status, and whether a research run of it holds facts', async () => {
    const { feed, published } = await setup()
    const researched = await published(30)
    await createResearchRun(researched.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    const bare = await published(1)
    await createResearchRun(bare.id, [{ id: 'S0', facts: [] }])
    const draft = await createStory({ feedId: feed.id, status: 'selected' })
    await createResearchRun(draft.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])

    expect(await contextEligibility(prisma, researched.id)).toEqual({ status: 'published', researched: true })
    expect(await contextEligibility(prisma, bare.id)).toEqual({ status: 'published', researched: false })
    expect(await contextEligibility(prisma, draft.id)).toEqual({ status: 'selected', researched: true })
    expect(await contextEligibility(prisma, '00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it("loads what the story's earlier completed runs did (a failed or running one counts for nothing), copies and demoted facts left out of the carried ones", async () => {
    const { published } = await setup()
    const story = await published(1)
    const other = await published(1)
    const record = (searches: { slot: string; query: string; wanted?: string; angle?: string; kept?: string[] }[]) => ({
      searches: searches.map(s => ({ wanted: '', recent: false, cached: false, credits: 1, results: 1, kept: [], ...s })),
    })
    const first = await createContextRun(story.id, {
      startedAt: ago(3),
      result: record([
        // A record from before angles were stored: read by its `wanted` text
        { slot: 'response', query: 'Fires Response', wanted: RESPONSE_ANGLES[0]!.wanted, kept: ['https://read.example/one'] },
        { slot: 'compared', query: 'fires record', kept: [] },
      ]),
    })
    const second = await createContextRun(story.id, {
      startedAt: ago(2),
      result: record([{ slot: 'response', query: 'what worked elsewhere', angle: 'elsewhere', kept: ['https://read.example/two'] }]),
    })
    const failed = await createContextRun(story.id, { status: 'failed', outcome: 'technical', result: record([{ slot: 'why_now', query: 'failed query' }]) })
    const current = await createContextRun(story.id, { status: 'running', result: record([{ slot: 'next', query: 'own first attempt' }]) })
    await createContextRun(other.id, { result: record([{ slot: 'next', query: 'another story' }]) })

    const research = await createContextFact(story.id, first.id, { ref: 'S0F1', origin: 'research', sourceUrl: 'https://orig.example/a' })
    const rejected = await createContextFact(story.id, first.id, { ref: 'S0F2', origin: 'research', sourceUrl: 'https://orig.example/a', verdict: 'rejected' })
    await createContextFact(story.id, first.id, { ref: 'S0F3', origin: 'research', sourceUrl: 'https://orig.example/a', verdict: 'unjudged' })
    const demoted = await createContextFact(story.id, first.id, { ref: 'S0F4', origin: 'research', sourceUrl: 'https://orig.example/a', status: 'demoted' })
    const found = await createContextFact(story.id, second.id, { ref: 'S3F1', sourceUrl: 'https://read.example/two' })
    // The second run's copy of the first's fact, and a copy of another story's: neither is carried
    await createContextFact(story.id, second.id, { ref: 'S4F1', origin: 'research', sourceUrl: 'https://orig.example/a', reusedFromId: research.id })
    await createContextFact(story.id, second.id, { ref: 'S5F1', sourceUrl: 'https://another.example/x', reusedFromId: 'elsewhere' })
    await createContextFact(story.id, failed.id, { ref: 'S3F1', sourceUrl: 'https://failed.example/x' })
    await createContextFact(story.id, current.id, { ref: 'S3F1', sourceUrl: 'https://current.example/x' })

    const work = await loadEarlierWork(prisma, story.id)
    expect(work.facts.map(f => f.id)).toEqual([found.id, research.id])
    expect(work.facts[0]).toMatchObject({ ref: 'S3F1', origin: 'search', verdict: 'supported', source: { url: 'https://read.example/two' } })
    const key = (f: { sourceUrl: string; supportingSentence: string; statement: string }) => factKey({ url: f.sourceUrl, ...f })
    expect(work.judged.sort()).toEqual([research, rejected, demoted].map(key).sort())
    expect(work.queries.sort()).toEqual(['fires record', 'fires response', 'what worked elsewhere'])
    expect(work.angles.sort()).toEqual(['action', 'elsewhere'])
    expect(work.read.sort()).toEqual(['https://read.example/one', 'https://read.example/two'])

    expect(await loadEarlierWork(prisma, other.id)).toMatchObject({ facts: [], judged: [], queries: ['another story'] })
  })
})
