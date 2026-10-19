import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createsEmbeddingIndex, losesEmbeddingIndex as losesIndex } from '../scripts/check-migrations/rules.js'

/**
 * Guards the pgvector HNSW index `stories_embedding_idx`.
 *
 * The index is created by raw SQL in 20260206120000_add_embedding_fields. Prisma cannot
 * represent it, so `migrate dev --create-only` and `migrate diff` always propose
 * `DROP INDEX "stories_embedding_idx"`. Committing that line silently turns every vector
 * search into a sequential scan. A migration may drop the index only if it creates it again.
 * The detection lives in scripts/check-migrations/rules.ts, which `npm run check:migrations`
 * also runs in CI.
 */

const CREATING_MIGRATION = '20260206120000_add_embedding_fields'
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'migrations')

describe('stories_embedding_idx detection', () => {
  it.each([
    'DROP INDEX "stories_embedding_idx";',
    'drop index stories_embedding_idx;',
    'DROP INDEX IF EXISTS "public"."stories_embedding_idx";',
    'DROP INDEX CONCURRENTLY "Stories_Embedding_Idx";',
    'DROP INDEX "other_idx", "stories_embedding_idx";',
    'ALTER TABLE "x" ADD COLUMN "y" TEXT;\n-- comment\nDROP INDEX\n  "stories_embedding_idx";',
  ])('flags a drop: %s', (sql) => {
    expect(losesIndex(sql)).toBe(true)
  })

  it.each([
    '-- Prisma emits DROP INDEX "stories_embedding_idx"; deliberately removed',
    '/* DROP INDEX "stories_embedding_idx"; */',
    'DROP INDEX "stories_embedding_idx_old";',
    'DROP INDEX "stories_url_idx";',
    'CREATE INDEX "stories_embedding_idx" ON "stories" USING hnsw ("embedding" vector_cosine_ops);',
  ])('does not flag: %s', (sql) => {
    expect(losesIndex(sql)).toBe(false)
  })

  it('allows a migration that drops and re-creates the index', () => {
    const sql =
      'DROP INDEX "stories_embedding_idx";\nCREATE INDEX "stories_embedding_idx" ON "stories" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 32);'
    expect(losesIndex(sql)).toBe(false)
  })

  it('flags a re-create that comes before the drop', () => {
    const sql =
      'CREATE INDEX "stories_embedding_idx" ON "stories" USING hnsw ("embedding" vector_cosine_ops);\nDROP INDEX "stories_embedding_idx";'
    expect(losesIndex(sql)).toBe(true)
  })

  it('does not count a non-HNSW index or one on another table as re-creating it', () => {
    expect(losesIndex('DROP INDEX "stories_embedding_idx";\nCREATE INDEX "stories_embedding_idx" ON "stories" ("embedding");')).toBe(true)
    expect(
      losesIndex('DROP INDEX "stories_embedding_idx";\nCREATE INDEX "stories_embedding_idx" ON "other" USING hnsw ("embedding" vector_cosine_ops);'),
    ).toBe(true)
  })

  it('does not count an index on a column of that name as re-creating it', () => {
    const sql = 'DROP INDEX "stories_embedding_idx";\nCREATE INDEX "other" ON "t" ("stories_embedding_idx");'
    expect(losesIndex(sql)).toBe(true)
  })
})

describe('committed migrations', () => {
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(MIGRATIONS_DIR, d.name, 'migration.sql')))
    .map((d) => ({ name: d.name, sql: readFileSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'), 'utf8') }))

  it('finds the migration that creates the index, so the scan cannot pass vacuously', () => {
    const creator = migrations.find((m) => m.name === CREATING_MIGRATION)
    expect(creator).toBeDefined()
    expect(createsEmbeddingIndex(creator?.sql ?? '')).toBe(true)
  })

  it('never drop stories_embedding_idx without re-creating it', () => {
    const offenders = migrations.filter((m) => losesIndex(m.sql)).map((m) => m.name)
    expect(offenders).toEqual([])
  })
})
