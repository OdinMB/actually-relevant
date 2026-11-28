import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, prismaWrites, sourceFiles } from './writeFence.js'

/**
 * Keeps a research pass's cards behind the card gate on every reader path (`.context/research-passes.md`,
 * "The cards a pass writes"): readers get a story's cards only through `readerCardRecords`
 * (`services/storyCards.ts`), which serves none of a pass's while `CARD_EVAL_GATE` is closed. Every
 * non-test source file under `src/` except `src/scripts/` and `src/test/` is scanned for the reads that
 * would go around it: `cardRecords(` outside its module and the admin's view and edits,
 * `newestPassBoxes(` outside where it is defined and `storyCards.ts`, a Prisma read of `passBox` outside
 * the pass's records, its writes and the admin's edits, and raw SQL reading `pass_boxes`. A new reader
 * fails here until it takes `readerCardRecords` or is added below as one readers never see.
 */

const SKIPPED_DIRS = new Set([join('scripts'), join('test')])
const CARDS = join('services', 'storyCards.ts')
const ADMIN = join('services', 'storyContextAdmin.ts')
const RECORDS = join('services', 'passRecords.ts')
const WRITES = join('services', 'passWrites.ts')

const READS = ['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy']

/** Each way of reading cards, with the files allowed to use it. */
const FENCES: { allowed: ReadonlySet<string>; find: (src: string) => string[] }[] = [
  { allowed: new Set([CARDS, ADMIN]), find: src => calls(src, 'cardRecords') },
  { allowed: new Set([CARDS, RECORDS]), find: src => calls(src, 'newestPassBoxes') },
  { allowed: new Set([RECORDS, WRITES, ADMIN]), find: src => prismaWrites(src, 'passBox', READS, null) },
  { allowed: new Set(), find: src => rawReads(src) },
]

/** Calls of `name`, a property's (`cards.cardRecords(`) included, never a longer name ending in it. */
function calls(src: string, name: string): string[] {
  return [...src.matchAll(new RegExp(`(?<![\\w$])${name}\\s*\\(`, 'g'))].map(m => `${name}( at offset ${m.index}`)
}

function rawReads(src: string): string[] {
  return [...src.matchAll(/\b(FROM|JOIN)\s+"?pass_boxes"?(?![\w"])/gi)].map(m => `raw read of pass_boxes at offset ${m.index}`)
}

const offenders = () =>
  FENCES.flatMap(({ allowed, find }) =>
    sourceFiles(SRC, allowed, SKIPPED_DIRS).flatMap(path => find(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`)),
  )

describe('pass card readers', () => {
  it('every read of a story’s served cards outside the admin goes through readerCardRecords', () => {
    expect(offenders()).toEqual([])
  })

  it('the scan finds the read shapes it guards against', () => {
    const [records, newest, prismaRead, raw] = FENCES.map(f => f.find)
    expect(records!('const { boxes, facts } = await cardRecords(prisma, story.id)')).toHaveLength(1)
    expect(records!("const { boxes } = await (await import('./storyCards.js')).cardRecords(prisma, id)")).toHaveLength(1)
    expect(newest!('const boxes = await newestPassBoxes(db, storyId)')).toHaveLength(1)
    expect(prismaRead!('await prisma.passBox.findMany({ where: { storyId } })')).toHaveLength(1)
    expect(prismaRead!('await tx.passBox.findFirst({ where: { storyId }, orderBy: { writtenAt: "desc" } })')).toHaveLength(1)
    expect(raw!('await prisma.$queryRaw`SELECT b.id FROM pass_boxes b WHERE b.story_id = ${id}`')).toHaveLength(1)
    expect(raw!('await prisma.$queryRaw`SELECT 1 FROM stories s JOIN "pass_boxes" b ON b.story_id = s.id`')).toHaveLength(1)
  })

  it('the scan ignores the gated read, a name not called and the other tables', () => {
    const [records, newest, prismaRead, raw] = FENCES.map(f => f.find)
    expect(records!('const { boxes, facts } = await readerCardRecords(prisma, story.id)')).toEqual([])
    expect(newest!("import { loadCitedFacts, newestPassBoxes } from './passRecords.js'")).toEqual([])
    expect(prismaRead!('await tx.passBox.createMany({ data: rows })')).toEqual([])
    expect(prismaRead!('await prisma.contextBox.findMany({ where: { storyId } })')).toEqual([])
    expect(raw!('INSERT INTO pass_boxes (id) VALUES ($1)')).toEqual([])
    expect(raw!('SELECT id FROM context_boxes')).toEqual([])
  })
})
