import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, prismaWrites, rawInsertsOrDeletes, rawUpdates, sourceFiles } from './writeFence.js'

/**
 * Keeps `services/researchPassLifecycle.ts` the only code that writes a research pass's row
 * (`.context/research-passes.md`, "Running a pass"): its claim, its status and every column it
 * settles with, so each move from `running` stays fenced on it. Every non-test source file under
 * `src/` except the module itself, `src/scripts/` and `src/test/` is scanned for any Prisma
 * `researchPass` create, update, upsert or delete, and raw SQL inserting, updating or deleting rows of
 * `research_passes`. A pass's other rows (pool, versions, cards) are `passWrites.ts`'s.
 */

const ALLOWED = new Set([join('services', 'researchPassLifecycle.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test')])

const OPERATIONS = ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']

export function passRowWrites(src: string): string[] {
  return [...prismaWrites(src, 'researchPass', OPERATIONS, null), ...rawUpdates(src, 'research_passes', /\w/), ...rawInsertsOrDeletes(src, 'research_passes')]
}

describe('research pass row writers', () => {
  it('only the lifecycle module writes a pass row', () => {
    const offenders = sourceFiles(SRC, ALLOWED, SKIPPED_DIRS).flatMap(path =>
      passRowWrites(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`),
    )
    expect(offenders).toEqual([])
  })

  it('the scan finds the write shapes it guards against', () => {
    expect(passRowWrites(`await tx.researchPass.create({ data: { storyId, status: 'running' } })`)).toHaveLength(1)
    expect(passRowWrites(`await prisma.researchPass.updateMany({ where: { id, status: 'running' }, data: { status: 'failed' } })`)).toHaveLength(1)
    expect(passRowWrites(`await tx.researchPass.update({ where: { id: passId }, data: { versionId } })`)).toHaveLength(1)
    expect(passRowWrites(`await prisma.researchPass.deleteMany({ where: { storyId } })`)).toHaveLength(1)
    expect(passRowWrites("await prisma.$executeRaw`UPDATE research_passes SET status = 'failed' WHERE id = ${id}`")).toHaveLength(1)
    expect(passRowWrites('await prisma.$executeRaw`INSERT INTO "research_passes" (id) VALUES (${id})`')).toHaveLength(1)
  })

  it('the scan ignores reads and the other pass tables', () => {
    expect(passRowWrites(`await prisma.researchPass.findMany({ where: { status: 'running' } })`)).toEqual([])
    expect(passRowWrites(`await tx.researchPass.aggregate({ where: { storyId }, _max: { number: true } })`)).toEqual([])
    expect(passRowWrites(`await tx.passBox.createMany({ data: rows })`)).toEqual([])
    expect(passRowWrites('await prisma.$queryRaw`SELECT p.id FROM research_passes p WHERE p.status = ${s}`')).toEqual([])
  })
})
