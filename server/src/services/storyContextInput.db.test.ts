import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextFact, createContextRun, createResearchRun } from '../test/db/storyContext.js'
import { loadContextInput, nextForContext } from './storyContextInput.js'

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

  it('owes the published stories of the lookback with research facts and no context run, oldest first, up to the limit', async () => {
    const { feed, published } = await setup()
    const newer = await published(1)
    const older = await published(2.5)
    const tooOld = await published(3.5)
    const noFacts = await published(1)
    const failedResearch = await published(1)
    const settled = await published(1)
    const selected = await createStory({ feedId: feed.id, status: 'selected', datePublished: null })
    for (const s of [newer, older, tooOld, settled, selected]) await createResearchRun(s.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    await createResearchRun(noFacts.id, [{ id: 'S0', facts: [] }])
    await createResearchRun(failedResearch.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { status: 'failed' })
    await createContextRun(settled.id, { status: 'failed', outcome: 'technical' })

    expect(await nextForContext(prisma, 20, NOW)).toEqual([older.id, newer.id])
    expect(await nextForContext(prisma, 1, NOW)).toEqual([older.id])
  })

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

  it('loads nothing for a story that is not published or has no research facts', async () => {
    const { feed, published } = await setup()
    const draft = await createStory({ feedId: feed.id, status: 'selected' })
    await createResearchRun(draft.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    const bare = await published(1)
    await createResearchRun(bare.id, [{ id: 'S0', facts: [] }])
    expect(await loadContextInput(prisma, draft.id)).toBeNull()
    expect(await loadContextInput(prisma, bare.id)).toBeNull()
  })
})
