import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, prismaWrites, rawInsertsOrDeletes, rawUpdates, sourceFiles } from './writeFence.js'

/**
 * Keeps `services/overviewLifecycle.ts` and its folder, `services/overviewLifecycle/`, the only code
 * that writes the overview tables (`.context/overviews.md`, "Records"): every join, founding, detach,
 * role, stands version, status move and editor action goes through it and is logged as a decision.
 * Every non-test source file under `src/` except the module and its folder, `src/scripts/` and
 * `src/test/` is scanned for any Prisma create, update, upsert or delete of `overview`,
 * `overviewEntry`, `overviewStands` or `overviewDecision`, and raw SQL inserting, updating or deleting
 * rows of their tables.
 */

const LIFECYCLE_DIR = join('services', 'overviewLifecycle')
const ALLOWED = new Set([join('services', 'overviewLifecycle.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test'), LIFECYCLE_DIR])

const OPERATIONS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']
const MODELS = ['overview', 'overviewEntry', 'overviewStands', 'overviewDecision']
const TABLES = ['overviews', 'overview_entries', 'overview_stands', 'overview_decisions']

export function overviewWrites(src: string): string[] {
  return [
    ...MODELS.flatMap(model => prismaWrites(src, model, OPERATIONS, null)),
    ...TABLES.flatMap(table => [...rawUpdates(src, table, /\w/), ...rawInsertsOrDeletes(src, table)]),
  ]
}

describe('overview table writers', () => {
  it('only the lifecycle module writes the overview tables', () => {
    const offenders = sourceFiles(SRC, ALLOWED, SKIPPED_DIRS).flatMap(path =>
      overviewWrites(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`),
    )
    expect(offenders).toEqual([])
  })

  it('the lifecycle folder it allows holds the writers, and nothing outside it is allowed', () => {
    const inFolder = sourceFiles(join(SRC, LIFECYCLE_DIR), new Set(), new Set()).map(p => relative(join(SRC, LIFECYCLE_DIR), p))
    expect(inFolder.sort()).toEqual(['apply.ts', 'editor.ts', 'linking.ts', 'upkeep.ts'])
    expect(inFolder.flatMap(name => overviewWrites(readFileSync(join(SRC, LIFECYCLE_DIR, name), 'utf8'))).length).toBeGreaterThan(0)
  })

  it('the scan finds the write shapes it guards against', () => {
    expect(overviewWrites(`await tx.overview.create({ data: { title } })`)).toHaveLength(1)
    expect(overviewWrites(`await prisma.overviewEntry.updateMany({ where: { storyId }, data: { status: 'detached' } })`)).toHaveLength(1)
    expect(overviewWrites(`await tx.overviewStands.upsert({ where: { id }, create: {}, update: {} })`)).toHaveLength(1)
    expect(overviewWrites(`await tx.overviewDecision.createMany({ data: rows })`)).toHaveLength(1)
    expect(overviewWrites("await prisma.$executeRaw`UPDATE overview_entries SET status = 'detached' WHERE id = ${id}`")).toHaveLength(1)
    expect(overviewWrites('await prisma.$executeRaw`DELETE FROM "overviews" WHERE id = ${id}`')).toHaveLength(1)
    expect(overviewWrites('await prisma.$executeRaw`INSERT INTO overview_decisions (id) VALUES (${id})`')).toHaveLength(1)
  })

  it('the scan ignores reads and other tables', () => {
    expect(overviewWrites(`await prisma.overview.findMany({ where: { scope: 'ongoing' } })`)).toEqual([])
    expect(overviewWrites(`await tx.overviewDecision.findFirst({ where: { storyId, kind: 'link' } })`)).toEqual([])
    expect(overviewWrites('await db.$queryRaw`SELECT e.story_id FROM overview_entries e WHERE e.status = ${s}`')).toEqual([])
    expect(overviewWrites(`await tx.story.update({ where: { id }, data: { title } })`)).toEqual([])
  })
})
