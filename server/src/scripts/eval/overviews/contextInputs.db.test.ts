import { it, expect } from 'vitest'
import prisma from '../../../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../../test/db/harness.js'
import { createResearchRun } from '../../../test/db/storyContext.js'
import { loadInputsBySlug, loadPassInputsBySlug, loadUpdateStoriesBySlug } from './contextInputs.js'

describeDb('context inputs by slug', () => {
  useTestDatabase()

  it("loads each slug's input with production's loader, and null for a story without one or an unknown slug", async () => {
    const feed = await createFeed((await createIssue()).id)
    const published = (slug: string) =>
      createStory({
        feedId: feed.id,
        status: 'published',
        datePublished: new Date('2026-11-14T01:00:00Z'),
        slug,
        title: `Title ${slug}`,
        summary: 'One paragraph.',
      })
    const researched = await published('researched')
    await published('unresearched')
    await createResearchRun(researched.id, [{ id: 'S0', facts: [{ id: 'S0F1', statement: 'Fires burned 2.88 million hectares.' }] }])

    const inputs = await loadInputsBySlug(prisma, ['researched', 'unresearched', 'unknown'])
    expect([...inputs.keys()]).toEqual(['researched', 'unresearched', 'unknown'])
    expect(inputs.get('researched')).toMatchObject({ storyId: researched.id, title: 'Title researched', storyDay: '2026-11-14' })
    expect(inputs.get('researched')?.sources[0]?.facts.map(f => f.statement)).toEqual(['Fires burned 2.88 million hectares.'])
    expect(inputs.get('unresearched')).toBeNull()
    expect(inputs.get('unknown')).toBeNull()
    expect(await loadInputsBySlug(prisma, [])).toEqual(new Map())
  })

  it("loads each slug's first-pass input, and null for a story research cannot run on or an unknown slug", async () => {
    const feed = await createFeed((await createIssue()).id)
    const story = (slug: string, relevance: number | null) =>
      createStory({
        feedId: feed.id,
        status: 'published',
        datePublished: new Date('2026-11-14T01:00:00Z'),
        slug,
        title: `Title ${slug}`,
        summary: 'One.',
        relevance,
      })
    const rated = await story('rated', 6)
    await story('unrated', null)

    const inputs = await loadPassInputsBySlug(prisma, ['rated', 'unrated', 'unknown'])
    expect(inputs.get('rated')).toMatchObject({ passId: 'eval-rated', story: { id: rated.id }, version: null, storyDay: '2026-11-14' })
    expect(inputs.get('unrated')).toBeNull()
    expect(inputs.get('unknown')).toBeNull()
  })

  it("loads each slug's researched story as the legacy import makes it, writing nothing, and null without a researched version", async () => {
    const feed = await createFeed((await createIssue()).id)
    const story = (slug: string) =>
      createStory({ feedId: feed.id, status: 'published', datePublished: new Date('2026-11-14T01:00:00Z'), slug, title: `Title ${slug}`, summary: 'One.' })
    const researched = await story('researched')
    await story('plain')
    await createResearchRun(researched.id, [{ id: 'S0', facts: [{ id: 'S0F1', statement: 'Fires burned 2.88 million hectares.' }] }])
    const research = {
      paragraphs: [{ sentences: [{ text: 'Fires burned 2.88 million hectares.', citations: [{ sourceId: 'S0', sentence: 'Sentence S0F1.' }] }] }],
      whyThisMatters: [],
      caveats: [],
      quoteSourceId: null,
      sources: [],
    }
    await prisma.story.update({ where: { id: researched.id }, data: { research } })

    const stories = await loadUpdateStoriesBySlug(prisma, ['researched', 'plain', 'unknown'])
    expect(stories.get('researched')).toMatchObject({ slug: 'researched', storyDay: '2026-11-14', version: { kind: 'legacy', title: 'Title researched' } })
    expect(stories.get('researched')?.pool.facts.map(f => f.ref)).toEqual(['S0F1'])
    expect(stories.get('plain')).toBeNull()
    expect(stories.get('unknown')).toBeNull()
    // Read, never imported
    expect(await prisma.evidenceSource.count()).toBe(0)
    expect(await prisma.articleVersion.count()).toBe(0)
  })
})
