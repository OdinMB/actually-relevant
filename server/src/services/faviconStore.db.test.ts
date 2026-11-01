import { it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, describeDb, useTestDatabase } from '../test/db/harness.js'
import { activeFeedsForFavicons, getFavicon, hasFavicon, saveFavicon, _resetFaviconCache } from './faviconStore.js'

describeDb('feed favicons (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => _resetFaviconCache())

  it("stores and replaces a feed's PNG with its source, and deletes it with the feed", async () => {
    const feed = await createFeed((await createIssue()).id)
    expect(await getFavicon(feed.id)).toBeNull()

    await saveFavicon(feed.id, Buffer.from('first'), 'https://a.example/favicon.ico')
    await saveFavicon(feed.id, Buffer.from('second'), 'https://a.example/icon-32.png')

    expect(await hasFavicon(feed.id)).toBe(true)
    expect((await getFavicon(feed.id))?.png).toEqual(Buffer.from('second'))
    const row = await prisma.feedFavicon.findUniqueOrThrow({ where: { feedId: feed.id } })
    expect(row.sourceUrl).toBe('https://a.example/icon-32.png')
    expect(row.fetchedAt).toBeInstanceOf(Date)

    await prisma.feed.delete({ where: { id: feed.id } })
    expect(await prisma.feedFavicon.count()).toBe(0)
  })

  it('refuses a favicon for a feed that does not exist', async () => {
    await expect(saveFavicon(randomUUID(), Buffer.from('png'), 'https://a.example/favicon.ico')).rejects.toThrow()
  })

  it('lists the active feeds only, each with whether a favicon is stored', async () => {
    const issueId = (await createIssue()).id
    const withIcon = await createFeed(issueId)
    const without = await createFeed(issueId)
    const inactive = await createFeed(issueId)
    await prisma.feed.update({ where: { id: inactive.id }, data: { active: false } })
    await saveFavicon(withIcon.id, Buffer.from('png'), 'https://a.example/favicon.ico')

    const listed = await activeFeedsForFavicons()

    expect(new Map(listed.map(f => [f.id, f.hasFavicon]))).toEqual(
      new Map([
        [withIcon.id, true],
        [without.id, false],
      ]),
    )
  })
})
