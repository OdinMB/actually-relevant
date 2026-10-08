import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const jobs = await Promise.all([
    prisma.jobRun.upsert({
      where: { jobName: 'crawl_feeds' },
      update: {},
      create: { jobName: 'crawl_feeds', cronExpression: '0 */6 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'preassess_stories' },
      update: {},
      create: { jobName: 'preassess_stories', cronExpression: '0 1,7,13,19 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'assess_stories' },
      update: {},
      create: { jobName: 'assess_stories', cronExpression: '0 9,21 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'select_stories' },
      update: {},
      create: { jobName: 'select_stories', cronExpression: '0 10 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'publish_stories' },
      update: {},
      create: { jobName: 'publish_stories', cronExpression: '0 11 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'social_auto_post' },
      update: {},
      create: { jobName: 'social_auto_post', cronExpression: '30 11 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'bluesky_update_metrics' },
      update: {},
      create: { jobName: 'bluesky_update_metrics', cronExpression: '0 */6 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'mastodon_update_metrics' },
      update: {},
      create: { jobName: 'mastodon_update_metrics', cronExpression: '0 4 * * *', enabled: false },
    }),
    prisma.jobRun.upsert({
      where: { jobName: 'generate_newsletter' },
      update: {},
      create: { jobName: 'generate_newsletter', cronExpression: '0 4 * * 6', enabled: false },
    }),
    // Friday slots (UTC on Render); the handler does nothing outside its Friday window
    prisma.jobRun.upsert({
      where: { jobName: 'generate_podcast' },
      update: {},
      create: { jobName: 'generate_podcast', cronExpression: '0 2,6,10,14,18 * * 5', enabled: false },
    }),
    // Saturday 07:00 on Berlin's clock (jobs/jobTimeZones.ts), summer and winter time alike
    prisma.jobRun.upsert({
      where: { jobName: 'publish_podcast' },
      update: {},
      create: { jobName: 'publish_podcast', cronExpression: '0 7 * * 6', enabled: false },
    }),
    // Hourly read of Plunk spam complaints and bounces (ADR-0029)
    prisma.jobRun.upsert({
      where: { jobName: 'poll_plunk_activity' },
      update: {},
      create: { jobName: 'poll_plunk_activity', cronExpression: '20 * * * *', enabled: false },
    }),
  ])

  console.log(`Seeded ${jobs.length} job runs (all disabled)`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
