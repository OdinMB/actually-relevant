import { describe, it, expect } from 'vitest'
import { destructiveStatements, findProblems, isReviewedDestructive } from './rules.js'

describe('destructiveStatements', () => {
  it.each([
    ['DROP TABLE "email_events";', 'DROP TABLE'],
    ['drop table if exists foo cascade;', 'DROP TABLE'],
    ['TRUNCATE "stories";', 'TRUNCATE'],
    ['ALTER TABLE "stories" DROP COLUMN "source_name";', 'ALTER ... DROP'],
    ['ALTER TABLE "feeds"\n  DROP CONSTRAINT "feeds_url_key";', 'ALTER ... DROP'],
    ['ALTER TABLE "x" ALTER COLUMN "y" DROP NOT NULL;', 'ALTER ... DROP'],
  ])('flags %s', (sql, kind) => {
    const found = destructiveStatements(sql)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(new RegExp(`^${kind.replace(/\./g, '\\.')}: `))
  })

  it.each([
    'CREATE TABLE "drop_log" ("id" TEXT);',
    'ALTER TABLE "stories" ADD COLUMN "dropped_at" TIMESTAMP(3);',
    '-- DROP TABLE "stories";',
    '/* TRUNCATE "stories"; */',
    'DROP INDEX "stories_url_idx";',
    'UPDATE "stories" SET "status" = \'rejected\';',
  ])('does not flag %s', (sql) => {
    expect(destructiveStatements(sql)).toEqual([])
  })

  it('names each destructive statement of a migration', () => {
    const sql = 'ALTER TABLE "a" ADD COLUMN "b" TEXT;\nALTER TABLE "a" DROP COLUMN "c";\nDROP TABLE "d";'
    expect(destructiveStatements(sql)).toEqual(['ALTER ... DROP: ALTER TABLE "a" DROP COLUMN "c"', 'DROP TABLE: DROP TABLE "d"'])
  })
})

describe('isReviewedDestructive', () => {
  it('needs the marker on its own comment line, with a reason', () => {
    expect(isReviewedDestructive('-- reviewed-destructive: column unused since ADR-0046\nDROP TABLE "x";')).toBe(true)
    expect(isReviewedDestructive('--reviewed-destructive:  two-phase drop, code removed in abc123')).toBe(true)
    expect(isReviewedDestructive('-- reviewed-destructive:\nDROP TABLE "x";')).toBe(false)
    expect(isReviewedDestructive('-- reviewed-destructive:   \nDROP TABLE "x";')).toBe(false)
    expect(isReviewedDestructive('DROP TABLE "x"; -- reviewed-destructive: inline')).toBe(false)
  })
})

describe('findProblems', () => {
  const dropIndex = { name: '2_drop_index', sql: 'DROP INDEX "stories_embedding_idx";' }
  const oldDrop = { name: '1_old_drop', sql: 'DROP TABLE "email_events";' }
  const newDrop = { name: '3_new_drop', sql: 'ALTER TABLE "x" DROP COLUMN "y";' }
  const reviewed = { name: '4_reviewed', sql: '-- reviewed-destructive: code stopped reading it last deploy\nDROP TABLE "z";' }

  it('passes destructive migrations the branch does not add', () => {
    expect(findProblems([oldDrop], new Set())).toEqual([])
  })

  it('flags the embedding index drop in any migration, added or not', () => {
    expect(findProblems([dropIndex], new Set())).toHaveLength(1)
  })

  it('flags an added destructive migration unless it carries the marker', () => {
    const problems = findProblems([oldDrop, newDrop, reviewed], new Set(['3_new_drop', '4_reviewed']))
    expect(problems).toEqual([expect.stringMatching(/^3_new_drop: ALTER \.\.\. DROP: /)])
  })

  it('does not let the marker excuse the embedding index drop', () => {
    const marked = { name: '5_marked', sql: `-- reviewed-destructive: reasons\n${dropIndex.sql}` }
    expect(findProblems([marked], new Set(['5_marked']))).toHaveLength(1)
  })
})
