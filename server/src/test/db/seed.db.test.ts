import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '../../lib/prisma.js'
import { describeDb, useTestDatabase } from './harness.js'
import { seedDatabase, seedIssues } from '../../../prisma/seedDatabase.js'

const SEEDED_JOBS = ['assess_stories', 'crawl_feeds', 'preassess_stories', 'publish_stories', 'select_stories']

describeDb('development seed (PostgreSQL)', () => {
  useTestDatabase()
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes every seed issue as given, children under their parent, and the disabled job runs', async () => {
    await seedDatabase(prisma)

    const rows = await prisma.issue.findMany()
    expect(rows).toHaveLength(seedIssues.length)
    // Every field the seed writes, parentId included, so the children hang under their parent
    for (const issue of seedIssues) {
      expect(rows.find(r => r.slug === issue.slug)).toMatchObject(issue)
    }

    const jobs = await prisma.jobRun.findMany({ orderBy: { jobName: 'asc' } })
    expect(jobs.map(j => ({ jobName: j.jobName, enabled: j.enabled }))).toEqual(SEEDED_JOBS.map(jobName => ({ jobName, enabled: false })))
  })

  it('a second run restores edited issues in place and leaves job runs as they are', async () => {
    await seedDatabase(prisma)
    await prisma.issue.update({ where: { slug: 'planet-climate' }, data: { name: 'Renamed', intro: 'Edited' } })
    await prisma.jobRun.update({ where: { jobName: 'crawl_feeds' }, data: { enabled: true, cronExpression: '0 * * * *' } })

    await seedDatabase(prisma)

    expect(await prisma.issue.count()).toBe(seedIssues.length)
    const climate = seedIssues.find(i => i.slug === 'planet-climate')!
    expect(await prisma.issue.findUnique({ where: { slug: 'planet-climate' } })).toMatchObject(climate)
    expect(await prisma.jobRun.count()).toBe(SEEDED_JOBS.length)
    expect(await prisma.jobRun.findUnique({ where: { jobName: 'crawl_feeds' } })).toMatchObject({ enabled: true, cronExpression: '0 * * * *' })
  })
})
