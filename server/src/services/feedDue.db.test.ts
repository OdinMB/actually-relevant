import { it, expect } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, describeDb, useTestDatabase } from '../test/db/harness.js'
import { getDueFeeds } from './feed.js'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

describeDb('feeds due for crawling (PostgreSQL)', () => {
  useTestDatabase()

  it('takes a feed whose interval is up or ends within the grace, never one crawled more recently, nor an inactive one', async () => {
    const issueId = (await createIssue()).id
    const at = async (lastCrawledAt: Date | null, active = true) => {
      const feed = await createFeed(issueId)
      await prisma.feed.update({ where: { id: feed.id }, data: { lastCrawledAt, crawlIntervalHours: 24, active } })
      return feed.id
    }
    const never = await at(null)
    const overdue = await at(hoursAgo(25))
    // A daily crawl that finished seconds after yesterday's run started: due at today's run
    const secondsShort = await at(new Date(hoursAgo(24).getTime() + 20_000))
    const hoursShort = await at(hoursAgo(20))
    const inactive = await at(hoursAgo(30), false)

    const due = new Set((await getDueFeeds()).map(f => f.id))
    expect([never, overdue, secondsShort].every(id => due.has(id))).toBe(true)
    expect(due.has(hoursShort)).toBe(false)
    expect(due.has(inactive)).toBe(false)
  })
})
