import type { Prisma } from '@prisma/client'
import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { createContextFact, createContextRun, createResearchRun } from '../test/db/storyContext.js'
import { importLegacyPool, legacyPoolPresent, readLegacyImport } from './legacyPool.js'
import { currentVersion, loadPool } from './passRecords.js'

async function story() {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  return createStory({ feedId: feed.id, status: 'published', title: 'Researched title', summary: 'Researched summary.', datePublished: new Date() })
}

const research = {
  paragraphs: [{ sentences: [{ text: 'Floods displaced 4,000.', citations: [{ sourceId: 'S2', sentence: 'Sentence S2F1.' }] }] }],
  whyThisMatters: [],
  caveats: [],
  quoteSourceId: null,
  sources: [],
}

const importIn = (storyId: string) => prisma.$transaction(tx => importLegacyPool(tx, storyId))

describeDb('importLegacyPool', () => {
  useTestDatabase()

  it("imports a story's research and context runs once: sources, facts with the verdicts context gave, searches and version 1", async () => {
    const s = await story()
    await prisma.story.update({ where: { id: s.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    const run = await createResearchRun(s.id, [
      { id: 'S0', facts: [{ id: 'S0F1' }] },
      { id: 'S2', facts: [{ id: 'S2F1' }, { id: 'S2F2' }] },
    ])
    await prisma.storyResearchRun.update({
      where: { id: run.id },
      data: { result: { ...(run.result as object), searches: [{ query: 'Kenya floods', language: 'en', results: 5, credits: 2, cached: false }] } },
    })
    // An older run with facts is not the one context reads
    await createResearchRun(s.id, [{ id: 'S0', facts: [{ id: 'S0F1', statement: 'Old statement' }] }], { startedAt: new Date(Date.now() - 86_400_000) })
    const ctx = await createContextRun(s.id, {
      researchRunId: run.id,
      result: { searches: [{ slot: 'response', wanted: 'w', query: 'Kenya flood response', angle: 'action', kept: ['https://s7.example/a'] }] },
    })
    // Context judged S2F1 (research's), rejected S2F2, and found a fact of its own on another page
    await createContextFact(s.id, ctx.id, {
      ref: 'S2F1',
      origin: 'research',
      sourceUrl: `https://s2.example/${s.id}`,
      supportingSentence: 'Sentence S2F1.',
      statement: 'Statement S2F1',
      value: 4000,
      unit: 'people',
      validity: 'slow',
    })
    await createContextFact(s.id, ctx.id, {
      ref: 'S2F2',
      origin: 'research',
      sourceUrl: `https://s2.example/${s.id}`,
      supportingSentence: 'Sentence S2F2.',
      statement: 'Statement S2F2',
      verdict: 'rejected',
      verdictProblem: 'Wrong year.',
    })
    await createContextFact(s.id, ctx.id, { ref: 'S7F1', passage: 'Before. Sentence of S7F1. After.', value: 12, validity: 'fast' })

    expect(await importIn(s.id)).toBe('imported')

    const pool = await loadPool(prisma, s.id)
    expect(pool.sources.map(x => [x.ref, x.origin])).toEqual([
      ['S0', 'original'],
      ['S2', 'search'],
      ['S3', 'search'],
    ])
    expect(pool.facts.map(f => [f.ref, f.verdict, f.structured?.value ?? null])).toEqual([
      ['S0F1', 'unjudged', null],
      ['S2F1', 'supported', 4000],
      ['S2F2', 'rejected', null],
      ['S3F1', 'supported', 12],
    ])
    expect(pool.facts.find(f => f.ref === 'S0F1')?.statement).toBe('Statement S0F1')
    expect(pool.searches.map(x => [x.kind, x.query, x.angle, x.passId])).toEqual([
      ['coverage', 'Kenya floods', null, null],
      ['gap', 'Kenya flood response', 'action', null],
    ])
    expect(await currentVersion(prisma, s.id)).toMatchObject({ number: 1, kind: 'legacy', title: 'Researched title', summary: 'Researched summary.', research })

    expect(await importIn(s.id)).toBe('present')
    expect(await prisma.poolFact.count()).toBe(4)
  })

  it('imports nothing for a story without legacy runs or researched text', async () => {
    const s = await story()
    expect(await importIn(s.id)).toBe('none')
    expect(await prisma.evidenceSource.count()).toBe(0)
    expect(await prisma.articleVersion.count()).toBe(0)
  })

  it('imports what was read before the lock, after checking again under it that the story still has no pool', async () => {
    const s = await story()
    await prisma.story.update({ where: { id: s.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    await createResearchRun(s.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }])
    expect(await legacyPoolPresent(prisma, s.id)).toBe(false)
    const read = await readLegacyImport(prisma, s.id)

    // Another claim imported the story between the read and the lock: nothing is imported twice
    expect(await importIn(s.id)).toBe('imported')
    expect(await legacyPoolPresent(prisma, s.id)).toBe(true)
    expect(await prisma.$transaction(tx => importLegacyPool(tx, s.id, read))).toBe('present')
    expect(await prisma.poolFact.count()).toBe(1)
    expect(await prisma.articleVersion.count()).toBe(1)

    // With no pool yet, the read is what is imported, without reading again
    const t = await story()
    await createResearchRun(t.id, [{ id: 'S0', facts: [{ id: 'S0F1' }, { id: 'S0F2' }] }])
    const early = await readLegacyImport(prisma, t.id)
    await createResearchRun(t.id, [{ id: 'S0', facts: [{ id: 'S0F1' }] }], { startedAt: new Date(Date.now() + 60_000) })
    expect(await prisma.$transaction(tx => importLegacyPool(tx, t.id, early))).toBe('imported')
    expect((await loadPool(prisma, t.id)).facts.map(f => f.ref)).toEqual(['S0F1', 'S0F2'])
  })

  it('makes version 1 alone for a researched story whose runs hold no facts', async () => {
    const s = await story()
    await prisma.story.update({ where: { id: s.id }, data: { research: research as unknown as Prisma.InputJsonObject } })
    expect(await importIn(s.id)).toBe('imported')
    expect((await loadPool(prisma, s.id)).sources).toEqual([])
    expect(await currentVersion(prisma, s.id)).toMatchObject({ kind: 'legacy' })
  })
})
