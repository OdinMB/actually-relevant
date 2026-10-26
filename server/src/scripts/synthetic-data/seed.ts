/**
 * Writes the synthetic data set (`dataset.ts`) into a database: empties every table but Prisma's
 * migration history and `job_runs`, inserts the set and the admin login in one transaction, and
 * switches every scheduled job off, so a server started against the database calls no paid API on
 * its own. A database holding feeds, stories or users the set did not write is refused unless the
 * caller asks for a reset. Which databases it may touch at all is `guard.ts`; the command is `index.ts`.
 */
import type { Prisma, PrismaClient, StoryStatus } from '@prisma/client'
import { config } from '../../config.js'
import { hashPassword } from '../../services/auth.js'
import { SYNTHETIC_ADMIN, SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_ORIGIN, buildSyntheticDataset, syntheticId } from './dataset.js'

/** The database holds data the synthetic set did not write, and no reset was asked for. */
export class SyntheticSeedRefusal extends Error {}

export interface SeedSummary {
  issues: number
  feeds: number
  stories: Partial<Record<StoryStatus, number>>
  clusters: number
  newsletters: number
  podcasts: number
  users: number
}

/** Rows the synthetic set would not have written: feeds and stories off its host, users off its email domain. */
export async function foreignRows(db: PrismaClient): Promise<{ feeds: number; stories: number; users: number }> {
  const [feeds, stories, users] = await Promise.all([
    db.feed.count({ where: { NOT: { rssUrl: { startsWith: `${SYNTHETIC_ORIGIN}/` } } } }),
    db.story.count({ where: { NOT: { sourceUrl: { startsWith: `${SYNTHETIC_ORIGIN}/` } } } }),
    db.user.count({ where: { NOT: { email: { endsWith: SYNTHETIC_EMAIL_DOMAIN } } } }),
  ])
  return { feeds, stories, users }
}

/** Truncate every table but Prisma's migration history and the job schedule (whose rows the migrations seed). */
async function emptyTables(tx: Prisma.TransactionClient): Promise<void> {
  const tables = await tx.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename NOT IN ('_prisma_migrations', 'job_runs')`
  const list = tables.map(t => `"${t.tablename.replace(/"/g, '""')}"`).join(', ')
  await tx.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

/**
 * Replace everything in the database with the synthetic set, dated back from `now`. Without `reset`
 * it refuses (SyntheticSeedRefusal) when the database holds anything `foreignRows` counts, and then
 * changes nothing.
 */
export async function seedSyntheticData(db: PrismaClient, options: { now: Date; reset: boolean }): Promise<SeedSummary> {
  const foreign = await foreignRows(db)
  if (foreign.feeds + foreign.stories + foreign.users > 0 && !options.reset) {
    throw new SyntheticSeedRefusal(
      `the database holds ${foreign.feeds} feed(s), ${foreign.stories} story(ies) and ${foreign.users} user(s) that are not synthetic; ` +
        'pass --reset to delete everything in it and seed anyway',
    )
  }

  const data = buildSyntheticDataset(options.now, config.siteUrl)
  const passwordHash = await hashPassword(SYNTHETIC_ADMIN.password)
  await db.$transaction(
    async tx => {
      await emptyTables(tx)
      await tx.issue.createMany({ data: data.issues })
      await tx.issue.createMany({ data: data.childIssues })
      await tx.feed.createMany({ data: data.feeds })
      await tx.story.createMany({ data: data.stories.map(s => s.row) })
      await tx.storyCluster.create({ data: { id: data.cluster.id, primaryStoryId: data.cluster.primaryStoryId } })
      await tx.story.updateMany({ where: { id: { in: data.cluster.memberIds } }, data: { clusterId: data.cluster.id } })
      await tx.newsletter.createMany({ data: data.newsletters })
      await tx.podcast.createMany({ data: data.podcasts })
      await tx.user.create({ data: { id: syntheticId('user:admin'), email: SYNTHETIC_ADMIN.email, name: SYNTHETIC_ADMIN.name, passwordHash, role: 'admin' } })
      // Nothing runs on a schedule against this database: no crawl, no model call, no send
      await tx.jobRun.updateMany({ data: { enabled: false } })
    },
    { timeout: 60_000 },
  )

  const stories: SeedSummary['stories'] = {}
  for (const { row } of data.stories) stories[row.status!] = (stories[row.status!] ?? 0) + 1
  return {
    issues: data.issues.length + data.childIssues.length,
    feeds: data.feeds.length,
    stories,
    clusters: 1,
    newsletters: data.newsletters.length,
    podcasts: data.podcasts.length,
    users: 1,
  }
}

/** One line for the command's output. */
export function describeSummary(s: SeedSummary): string {
  const total = Object.values(s.stories).reduce((sum, n) => sum + n, 0)
  const byStatus = Object.entries(s.stories)
    .map(([status, n]) => `${n} ${status}`)
    .join(', ')
  return (
    `seeded ${s.issues} issues, ${s.feeds} feeds, ${total} stories (${byStatus}), ${s.clusters} dedup cluster, ` +
    `${s.newsletters} newsletter issues, ${s.podcasts} podcast episodes and ${s.users} admin user`
  )
}
