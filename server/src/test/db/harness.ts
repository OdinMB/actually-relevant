/**
 * Helpers for PostgreSQL integration tests (`*.db.test.ts`). A file wraps its tests in `describeDb`
 * and calls `useTestDatabase()` inside it: every table is truncated before each test, so a test
 * starts from an empty, fully migrated database (job_runs seed rows included: tests insert what they
 * need). See `.context/database-migrations.md`, "Integration tests".
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe } from 'vitest'
import type { RejectionReason, StoryStatus } from '@prisma/client'
import prisma from '../../lib/prisma.js'
import { testDatabaseRefusal } from './guard.js'

/**
 * `describe` for a db test file. It no longer skips: the db project's global setup fails the run
 * when TEST_DATABASE_URL is missing. Kept as a name so the db test files read alike.
 */
export const describeDb = describe

/** Truncate every table but Prisma's migration history. */
export async function truncateAllTables(): Promise<void> {
  // Belt and braces next to globalSetup: never truncate anything but the guarded test database
  const url = process.env.DATABASE_URL
  if (!url || url !== process.env.TEST_DATABASE_URL || testDatabaseRefusal(url)) {
    throw new Error('refusing to truncate: DATABASE_URL is not the guarded TEST_DATABASE_URL')
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  const list = tables.map(t => `"${t.tablename.replace(/"/g, '""')}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

/** Register the per-test truncate and the final disconnect. Call inside a `describeDb` block. */
export function useTestDatabase(): void {
  beforeEach(truncateAllTables)
  afterAll(() => prisma.$disconnect())
}

// ──── Fixtures ────────────────────────────────────────────────────────────

export async function createIssue(data: { slug?: string; parentId?: string } = {}) {
  const slug = data.slug ?? `issue-${randomUUID().slice(0, 8)}`
  return prisma.issue.create({ data: { name: slug, slug, parentId: data.parentId ?? null } })
}

export async function createFeed(issueId: string) {
  const id = randomUUID().slice(0, 8)
  return prisma.feed.create({ data: { title: `Feed ${id}`, rssUrl: `https://feed-${id}.example/rss`, issueId } })
}

const MONTH_MS = 31 * 24 * 60 * 60 * 1000

/** A date about `months` months ago (31-day months, so "7 months ago" is safely past a 6-month cutoff). */
export const monthsAgo = (months: number) => new Date(Date.now() - months * MONTH_MS)

export async function createStory(data: {
  feedId: string
  status?: StoryStatus
  dateCrawled?: Date
  issueId?: string | null
  clusterId?: string | null
  slug?: string | null
  title?: string | null
  relevance?: number | null
  datePublished?: Date | null
  accessTier?: string | null
  rejectionReason?: RejectionReason | null
}) {
  const id = randomUUID()
  return prisma.story.create({
    data: {
      id,
      sourceUrl: `https://news.example/${id}`,
      sourceTitle: `Source ${id.slice(0, 8)}`,
      sourceContent: 'text',
      feedId: data.feedId,
      status: data.status ?? 'fetched',
      dateCrawled: data.dateCrawled ?? new Date(),
      issueId: data.issueId ?? null,
      clusterId: data.clusterId ?? null,
      slug: data.slug ?? null,
      title: data.title ?? null,
      relevance: data.relevance ?? null,
      datePublished: data.datePublished ?? null,
      accessTier: data.accessTier ?? null,
      rejectionReason: data.rejectionReason ?? null,
    },
  })
}

/** A cluster of existing stories with the given primary (null: none yet). */
export async function createCluster(memberIds: string[], primaryId: string | null): Promise<string> {
  const cluster = await prisma.storyCluster.create({ data: { primaryStoryId: primaryId } })
  await prisma.story.updateMany({ where: { id: { in: memberIds } }, data: { clusterId: cluster.id } })
  return cluster.id
}

/** The lifecycle fields of each story, by id (a deleted story is absent). */
export async function statusesOf(ids: string[]) {
  const rows = await prisma.story.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, rejectionReason: true, slug: true, datePublished: true, clusterId: true },
  })
  return new Map(rows.map(r => [r.id, r]))
}

/** Store an embedding: a 1536-dimension unit vector along `axis` (cosine distance 0 to itself, 1 to any other axis). */
export async function setEmbedding(storyId: string, axis: number): Promise<void> {
  await prisma.$executeRaw`UPDATE stories SET embedding = ${axisVectorLiteral(axis)}::vector WHERE id = ${storyId}`
}

export function axisVector(axis: number): number[] {
  const v = new Array<number>(1536).fill(0)
  v[axis] = 1
  return v
}

const axisVectorLiteral = (axis: number) => `[${axisVector(axis).join(',')}]`
