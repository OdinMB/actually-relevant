/**
 * Slug assignment for publishing: unique slugs in the one global slug namespace, generated under a
 * transaction-scoped advisory lock so concurrent publishers never pick the same slug. Only the
 * publish move in `storyLifecycle.ts` assigns slugs (`.context/story-pipeline.md`, "Slugs").
 */
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { slugify } from '../utils/slugify.js'

// Application-defined key for the transaction-scoped advisory lock that serializes
// slug assignment across all concurrent publishers (see withSlugLock).
const SLUG_ASSIGNMENT_LOCK_KEY = 247_834_001

/**
 * Run `fn` inside a transaction holding the slug-assignment advisory lock. Every code
 * path that auto-generates a slug must go through here: slug assignment is a
 * read-modify-write over the global (unique) slug namespace, so without serialization
 * two concurrent publishers can pick the same slug for different stories and one fails
 * with P2002. The lock is always acquired BEFORE any row write, so no advisory⇄row lock
 * cycle can form; it auto-releases on commit/rollback. Holders only do fast set-based
 * work, so contention blocks briefly in practice.
 */
export async function withSlugLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async tx => {
      // Use $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns Postgres `void`,
      // and $queryRaw tries to deserialize the result column and throws P2010
      // ("Failed to deserialize column of type 'void'"). $executeRaw runs the statement
      // (acquiring the lock) and returns a row count, deserializing nothing.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLUG_ASSIGNMENT_LOCK_KEY}::bigint)`
      return fn(tx)
    },
    { timeout: config.database.transactionTimeoutMs },
  )
}

/**
 * A unique slug for each story, from its title (falling back to the source title). Pass the
 * transaction client of `withSlugLock` so the existing-slug read and the slug write see one
 * consistent namespace.
 */
export async function generateUniqueSlugs(
  stories: { id: string; title: string | null; sourceTitle: string }[],
  client: Prisma.TransactionClient = prisma,
): Promise<Map<string, string>> {
  if (stories.length === 0) return new Map()

  // Generate base slugs for all stories
  const baseSlugs = stories.map(s => ({
    id: s.id,
    base: slugify(s.title || s.sourceTitle),
  }))

  // Find all existing slugs that could conflict (matching any base pattern)
  const uniqueBases = [...new Set(baseSlugs.map(s => s.base))]
  const existingStories = await client.story.findMany({
    where: {
      slug: { not: null },
      id: { notIn: stories.map(s => s.id) },
      OR: uniqueBases.map(base => ({
        slug: { startsWith: base },
      })),
    },
    select: { slug: true },
  })
  const existingSlugs = new Set(existingStories.map(s => s.slug!))

  // Resolve conflicts: track slugs we're assigning in this batch too
  const assignedSlugs = new Set<string>()
  const result = new Map<string, string>()

  for (const { id, base } of baseSlugs) {
    let candidate = base
    let suffix = 2
    while (existingSlugs.has(candidate) || assignedSlugs.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix++
    }
    assignedSlugs.add(candidate)
    result.set(id, candidate)
  }

  return result
}

/**
 * Write the slugs in one statement. A per-story update loop here costs one round trip per story,
 * which blows past the transaction timeout once a publish chunk grows; every slug is unique by
 * construction (generateUniqueSlugs), so a batched UPDATE cannot violate the constraint.
 */
export async function saveSlugs(tx: Prisma.TransactionClient, slugs: Map<string, string>): Promise<void> {
  if (slugs.size === 0) return
  const rows = [...slugs.entries()].map(([storyId, slug]) => Prisma.sql`(${storyId}::text, ${slug}::text)`)
  await tx.$executeRaw`
    UPDATE stories AS s
    SET slug = v.slug
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, slug)
    WHERE s.id = v.id
  `
}
