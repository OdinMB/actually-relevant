import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

/**
 * Guards the pgvector HNSW index `stories_embedding_idx`.
 *
 * The index is created by raw SQL in 20260206120000_add_embedding_fields. Prisma cannot
 * represent it, so `migrate dev --create-only` and `migrate diff` always propose
 * `DROP INDEX "stories_embedding_idx"`. Committing that line silently turns every vector
 * search into a sequential scan. A migration may drop the index only if it creates it again.
 */

const INDEX = 'stories_embedding_idx'
const CREATING_MIGRATION = '20260206120000_add_embedding_fields'
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'migrations')

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function statements(sql: string): string[] {
  return stripComments(sql).split(';')
}

const namesIndex = new RegExp(`(^|[^a-z0-9_$])${INDEX}([^a-z0-9_$]|$)`, 'i')

/**
 * Drops are matched alone or in a list, quoted or not, schema-qualified or not, and in any
 * case (deliberately conservative: a quoted mixed-case name is a different index to Postgres).
 * The matching is textual: a drop hidden in a DO block or EXECUTE string, or an implicit drop
 * through DROP COLUMN "embedding" / DROP TABLE "stories", is not caught.
 */
function isDrop(s: string): boolean {
  return /^\s*drop\s+index\b/i.test(s) && namesIndex.test(s)
}

/** A HNSW index of that name on stories. */
function isCreate(s: string): boolean {
  const [head, ...rest] = s.split(/\bon\b/i)
  return (
    /^\s*create\s+(unique\s+)?index\b/i.test(s) &&
    namesIndex.test(head) &&
    /^\s*(only\s+)?("?public"?\.)?"?stories"?\s/i.test(rest.join('on')) &&
    /\busing\s+hnsw\b/i.test(s)
  )
}

/** True when the index ends the migration dropped: dropped, and not created again afterwards. */
function losesIndex(sql: string): boolean {
  const all = statements(sql)
  const lastDrop = all.findLastIndex(isDrop)
  return lastDrop !== -1 && !all.slice(lastDrop + 1).some(isCreate)
}

function createsIndex(sql: string): boolean {
  return statements(sql).some(isCreate)
}

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
    expect(createsIndex(creator?.sql ?? '')).toBe(true)
  })

  it('never drop stories_embedding_idx without re-creating it', () => {
    const offenders = migrations.filter((m) => losesIndex(m.sql)).map((m) => m.name)
    expect(offenders).toEqual([])
  })
})
