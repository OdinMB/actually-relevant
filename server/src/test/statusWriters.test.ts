import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, prismaWrites, rawUpdates, sourceFiles } from './writeFence.js'

/**
 * Keeps `services/storyLifecycle.ts` the only code that writes `stories.status` and
 * `stories.rejection_reason` (ADR-0045, `.context/story-pipeline.md`).
 *
 * Scans every non-test source file under `src/` except the module itself and `src/scripts/`
 * (one-off operator scripts) for:
 * - a Prisma `story.create|createMany|update|updateMany|updateManyAndReturn|upsert(...)` call
 *   whose `data` (or `create`/`update` for upsert) object literal has a `status` or
 *   `rejectionReason` key;
 * - a raw `UPDATE stories ... SET ...` naming `status` or `rejection_reason`.
 *
 * The match is textual (`writeFence.ts`): a `data` passed as a variable, or a key spread in from
 * elsewhere, is not seen (`createStory` spreads `initialStatus()` from the module, which is the
 * intended route).
 */

const ALLOWED = new Set([join('services', 'storyLifecycle.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test')])
const OPERATIONS = ['create', 'createMany', 'update', 'updateMany', 'updateManyAndReturn', 'upsert']
const STATUS_KEYS = new Set(['status', 'rejectionReason'])

export function statusWrites(src: string): string[] {
  return [...prismaWrites(src, 'story', OPERATIONS, STATUS_KEYS), ...rawUpdates(src, 'stories', /\b(status|rejection_reason)\b/i)]
}

describe('story status writers', () => {
  it('only the lifecycle module writes stories.status or rejection_reason', () => {
    const offenders = sourceFiles(SRC, ALLOWED, SKIPPED_DIRS).flatMap(path =>
      statusWrites(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`),
    )
    expect(offenders).toEqual([])
  })

  it('the scan finds the write shapes it guards against', () => {
    expect(statusWrites(`await prisma.story.update({ where: { id }, data: { status: 'published' } })`)).toHaveLength(1)
    expect(statusWrites(`await tx.story.updateMany({ where: { id: { in: ids } }, data: { title, rejectionReason: 'editor' } })`)).toHaveLength(1)
    expect(statusWrites(`await prisma.story.create({ data: { feedId, status: StoryStatus.fetched } })`)).toHaveLength(1)
    expect(statusWrites(`await prisma.story.upsert({ where: { id }, create: { id }, update: { status } })`)).toHaveLength(1)
    expect(statusWrites("await prisma.$executeRaw`UPDATE stories SET status = 'trashed' WHERE id = ${id}`")).toHaveLength(1)
    expect(statusWrites('await prisma.$executeRaw`UPDATE "stories" s SET rejection_reason = NULL FROM x`')).toHaveLength(1)
  })

  it('the scan ignores status in filters and other tables', () => {
    expect(statusWrites(`await prisma.story.updateMany({ where: { status: 'analyzed' }, data: { relevance: 3 } })`)).toEqual([])
    expect(statusWrites(`await prisma.story.update({ where: { id }, data: { feed: { connect: { id: f } } } })`)).toEqual([])
    expect(statusWrites(`await prisma.newsletter.update({ where: { id }, data: { status: 'sent' } })`)).toEqual([])
    expect(statusWrites("await prisma.$executeRaw`UPDATE stories SET embedding = NULL WHERE status = 'rejected'`")).toEqual([])
  })
})
