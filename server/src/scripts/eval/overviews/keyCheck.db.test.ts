import { it, expect } from 'vitest'
import prisma from '../../../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../../../test/db/harness.js'
import { createResearchRun } from '../../../test/db/storyContext.js'
import { loadKeyStories } from './keyCheck.js'

describeDb('key stories', () => {
  useTestDatabase()

  it('reads each named story with its text, whether a research run has a result, and whether a completed one holds facts', async () => {
    const feed = await createFeed((await createIssue()).id)
    const published = new Date('2026-11-14T01:10:00Z')
    const story = (slug: string) =>
      createStory({ feedId: feed.id, status: 'published', datePublished: published, slug, title: `Title ${slug}`, summary: 'Summary.' })
    const withFacts = await story('with-facts')
    const noFacts = await story('no-facts')
    const failed = await story('failed-run')
    await story('no-run')
    await createStory({ feedId: feed.id, status: 'published', datePublished: published, slug: 'not-asked' })
    await createResearchRun(withFacts.id, [
      { id: 'S0', facts: [] },
      { id: 'S2', facts: [{ id: 'S2F1' }] },
    ])
    await createResearchRun(noFacts.id, [{ id: 'S0', facts: [] }])
    await createResearchRun(failed.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { status: 'failed' })

    const loaded = await loadKeyStories(prisma, ['with-facts', 'no-facts', 'failed-run', 'no-run', 'unknown'])
    expect([...loaded.keys()].sort()).toEqual(['failed-run', 'no-facts', 'no-run', 'with-facts'])
    expect(Object.fromEntries([...loaded.values()].map(s => [s.slug, [s.hasResearchRun, s.hasResearchFacts]]))).toEqual({
      'with-facts': [true, true],
      'no-facts': [true, false],
      'failed-run': [true, false],
      'no-run': [false, false],
    })
    expect(loaded.get('with-facts')).toMatchObject({
      status: 'published',
      datePublished: published,
      title: 'Title with-facts',
      summary: 'Summary.',
      relevanceReasons: null,
      antifactors: null,
    })
  })
})
