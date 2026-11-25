import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { SRC, sourceFiles } from './writeFence.js'

/**
 * Keeps `services/readerQuotes.ts` the only code that turns a fact's support into a citation's
 * sentence (`quotedSentence`, `citationsOf`), so every citation a reader sees quotes the one sentence
 * that states its fact, never a whole support of two or more (owner, 2026-11-25). Every non-test
 * source file under `src/` except the module itself, `src/scripts/` and `src/test/` is scanned for a
 * `sentence:` key whose value, in the same expression, reads a `supportingSentence`. The match is
 * textual: a support passed through a variable or a map first is not seen.
 */

const ALLOWED = new Set([join('services', 'readerQuotes.ts')])
const SKIPPED_DIRS = new Set([join('scripts'), join('test')])

/** `sentence:` and, before the expression ends (a comma, a semicolon, a line break or a brace), a `supportingSentence`. */
const RAW_QUOTE = /\bsentence\s*:[^,;\n{}]*\bsupportingSentence\b/g

function rawQuotes(src: string): string[] {
  return [...src.matchAll(RAW_QUOTE)].map(m => `support quoted whole at offset ${m.index}`)
}

describe('reader quote writers', () => {
  it("only the reader quotes module turns a fact's support into a citation's sentence", () => {
    const offenders = sourceFiles(SRC, ALLOWED, SKIPPED_DIRS).flatMap(path =>
      rawQuotes(readFileSync(path, 'utf8')).map(w => `${relative(SRC, path).split(sep).join('/')}: ${w}`),
    )
    expect(offenders).toEqual([])
  })

  it('the scan finds the shapes it guards against', () => {
    expect(rawQuotes('bySource.set(sourceId, { sourceId, sentence: f.fact.supportingSentence || null })')).toHaveLength(1)
    expect(rawQuotes('bySource.set(sourceId, { sourceId, sentence: facts.get(ref)!.supportingSentence || null })')).toHaveLength(1)
    expect(rawQuotes('citations: [{ sourceId: id, sentence: fact.supportingSentence }]')).toHaveLength(1)
  })

  it('the scan ignores a support selected, copied under its own name, or a schema line', () => {
    expect(rawQuotes('select: { statement: true, supportingSentence: true }')).toEqual([])
    expect(rawQuotes('{ id: f.ref, supportingSentence: f.supportingSentence, measures: f.measures }')).toEqual([])
    expect(rawQuotes("sentence: z.string().nullable().describe('One sentence.'),\n  supportingSentence: z.string(),")).toEqual([])
    expect(rawQuotes('citations: citationsOf(line.facts.map(id => ({ sourceId: idOf(id), fact: facts.get(id)!.fact })))')).toEqual([])
  })
})
