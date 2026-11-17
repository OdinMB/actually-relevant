import { it, expect } from 'vitest'
import prisma from '../../../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../../test/db/harness.js'
import { createResearchRun } from '../../../test/db/storyContext.js'
import { loadInputsBySlug } from './contextInputs.js'

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
})
