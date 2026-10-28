import { it, expect, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { generateUniqueSlugs, withSlugLock } from './storySlugs.js'

let feedId: string

const slugOf = async (id: string) => (await prisma.story.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug

describeDb('story slugs (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(async () => {
    feedId = (await createFeed((await createIssue()).id)).id
  })

  it('returns an empty map for no stories', async () => {
    expect(await generateUniqueSlugs([])).toEqual(new Map())
  })

  it('slugs the title, or the source title when there is none', async () => {
    const result = await generateUniqueSlugs([
      { id: 's1', title: 'AI & Machine Learning: 2024 Update!', sourceTitle: 'Source' },
      { id: 's2', title: null, sourceTitle: 'My Source Article' },
    ])
    expect(result).toEqual(
      new Map([
        ['s1', 'ai-machine-learning-2024-update'],
        ['s2', 'my-source-article'],
      ]),
    )
  })

  it('suffixes past slugs already taken, and past earlier stories of the same batch', async () => {
    await createStory({ feedId, slug: 'hello-world' })
    await createStory({ feedId, slug: 'hello-world-2' })
    await createStory({ feedId, slug: 'unrelated' })

    const result = await generateUniqueSlugs([
      { id: 's1', title: 'Hello World', sourceTitle: 'Source' },
      { id: 's2', title: 'Hello World', sourceTitle: 'Source' },
      { id: 's3', title: 'Unrelated', sourceTitle: 'Source' },
      { id: 's4', title: 'Fresh', sourceTitle: 'Source' },
    ])
    expect([...result.values()]).toEqual(['hello-world-3', 'hello-world-4', 'unrelated-2', 'fresh'])
  })

  it("ignores the stories' own current slugs", async () => {
    const story = await createStory({ feedId, slug: 'test-article' })
    const result = await generateUniqueSlugs([{ id: story.id, title: 'Test Article', sourceTitle: 'Source' }])
    expect(result.get(story.id)).toBe('test-article')
  })

  it('withSlugLock serializes concurrent publishers, so the same title still gets distinct slugs', async () => {
    const stories = await Promise.all(Array.from({ length: 4 }, () => createStory({ feedId, title: 'Same Title' })))
    await Promise.all(
      stories.map(story =>
        withSlugLock(async tx => {
          const slugs = await generateUniqueSlugs([{ id: story.id, title: story.title, sourceTitle: story.sourceTitle }], tx)
          await tx.story.update({ where: { id: story.id }, data: { slug: slugs.get(story.id) } })
        }),
      ),
    )
    const slugs = await Promise.all(stories.map(s => slugOf(s.id)))
    expect(slugs.sort()).toEqual(['same-title', 'same-title-2', 'same-title-3', 'same-title-4'])
  })
})
