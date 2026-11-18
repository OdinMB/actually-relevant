import { expect, it } from 'vitest'
import prisma from '../lib/prisma.js'
import { createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { currentVersion, loadMemberFacts, loadPool, newestPassBoxes, publicVersions, storyVersions } from './passRecords.js'
import type { PassWrite } from './passWrites.js'
import { publicUpdates } from './publicUpdates.js'
import { storePassResult } from './researchPassLifecycle.js'
import type { ArticleVersionData, Pool, PoolFact, PoolSource } from './researchPool.js'
import type { DraftBox } from './storyContextChecks.js'

async function story() {
  const issue = await createIssue()
  const feed = await createFeed(issue.id)
  return createStory({ feedId: feed.id, status: 'selected' })
}

const createPass = (storyId: string, number: number) =>
  prisma.researchPass.create({ data: { storyId, number, trigger: 'pipeline', kind: number === 1 ? 'first' : 'later', costUsd: 0.4 }, select: { id: true } })

const source = (ref: string, extra: Partial<PoolSource> = {}): PoolSource => ({
  id: null,
  ref,
  origin: ref === 'S0' ? 'original' : 'search',
  earlierStoryId: null,
  url: `https://${ref.toLowerCase()}.example/story`,
  outlet: `Outlet ${ref}`,
  title: `Title ${ref}`,
  date: '2026-11-12',
  kind: 'news-report',
  country: 'Kenya',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [{ name: 'A. Person', role: 'minister', quote: 'We will act.', stance: 'For acting now.' }],
  optOutChecked: true,
  firstPassId: null,
  ...extra,
})

const fact = (ref: string, extra: Partial<PoolFact> = {}): PoolFact => ({
  id: null,
  ref,
  sourceRef: ref.replace(/F\d+$/, ''),
  reusedFromId: null,
  supportingSentence: `Sentence of ${ref}.`,
  passage: null,
  supportFound: true,
  statement: `Statement of ${ref}.`,
  measures: '',
  slot: null,
  structured: null,
  extractedBy: { model: 'test-small', promptVersion: 'ext00001' },
  verdict: 'unjudged',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
  ...extra,
})

const structured = {
  value: 212,
  valueHigh: null,
  unit: 'people',
  approx: 'exact' as const,
  provisional: false,
  counted: 'deaths',
  place: 'Kenya',
  asOf: '2026-11-10',
  credited: 'WHO',
  creditedKind: 'official' as const,
  validity: 'slow' as const,
  by: { model: 'test-small', promptVersion: 'str00001' },
}

const version = (number: number, passId: string | null): ArticleVersionData => ({
  id: null,
  number,
  kind: number === 1 ? 'first' : 'update',
  status: 'current',
  passId,
  title: `Title v${number}`,
  titleLabel: 'Label',
  summary: 'Summary.',
  marketingBlurb: 'Blurb.',
  quote: null,
  quoteAttribution: null,
  relevanceReasons: '- Point.',
  antifactors: '- Caveat.',
  emotionTag: 'calm',
  research: {
    paragraphs: [{ sentences: [{ text: 'P.', citations: [{ sourceId: 'S1', sentence: 'Sentence of S1F1.' }] }] }],
    whyThisMatters: [],
    caveats: [],
    quoteSourceId: null,
    sources: [],
  },
  article: {
    titleLabel: 'Label',
    title: `Title v${number}`,
    story: [{ text: 'P.', factIds: ['S1F1', 'S1F2'] }],
    summary: 'Summary.',
    whyThisMatters: [{ text: 'Point.', factIds: [] }],
    caveats: [{ text: 'Caveat.', factIds: [] }],
    quote: '',
    quoteAttribution: '',
    quoteSourceId: '',
    marketingBlurb: 'Blurb.',
    emotionTag: 'calm',
  },
  changes:
    number === 1
      ? []
      : [{ section: 'Story paragraph 1', from: 'Story paragraph 1', before: { text: 'Old P.', citations: [] }, after: { text: 'P.', citations: [] } }],
  note: number === 1 ? null : { text: 'Officials revised the count.', citations: [{ sourceId: 'S1', sentence: 'Sentence of S1F1.' }] },
})

const box: DraftBox = {
  type: 'compared',
  heading: 'Compared',
  teaser: '',
  place: 'P1',
  sentences: [{ text: 'Deaths rose to 212.', factIds: ['S1F1'] }],
  visual: null,
}

function write(storyId: string, passId: string, pool: Pool, extra: Partial<PassWrite> = {}): PassWrite {
  return {
    storyId,
    passId,
    pool,
    changed: [],
    version: null,
    boxes: [],
    boxFacts: new Map(),
    writer: null,
    pass: { status: 'completed', outcome: 'written', verdict: 'keep', modelUsd: 0.1, credits: 4, costUsd: 0.132, record: { steps: 1 }, error: null },
    now: new Date('2026-11-17T02:00:00Z'),
    ...extra,
  }
}

const strip = (pool: Pool) => ({
  sources: pool.sources.map(({ id: _id, ...s }) => s),
  facts: pool.facts.map(({ id: _id, ...f }) => f),
  searches: pool.searches,
  dropped: pool.dropped,
})

describeDb('passRecords', () => {
  useTestDatabase()

  it('round-trips a pass: its sources, facts with their judgments, searches, dropped pages, version and cards', async () => {
    const s = await story()
    const pass = await createPass(s.id, 1)
    const pool: Pool = {
      sources: [source('S0', { firstPassId: pass.id }), source('S1', { firstPassId: pass.id, voices: [] })],
      facts: [
        fact('S0F1', { firstPassId: pass.id }),
        fact('S1F1', {
          firstPassId: pass.id,
          passage: 'Before. Sentence of S1F1. After.',
          slot: 'compared',
          structured,
          verdict: 'supported',
          checkedBy: { model: 'test-small', promptVersion: 'chk00001', passId: pass.id },
        }),
        fact('S1F2', {
          firstPassId: pass.id,
          verdict: 'rejected',
          verdictProblem: 'Not in the sentence.',
          checkedBy: { model: 'm', promptVersion: 'v', passId: pass.id },
        }),
      ],
      searches: [
        {
          kind: 'coverage',
          slot: null,
          angle: null,
          query: 'Kenya floods',
          normalizedQuery: 'kenya floods',
          windowStart: '2026-11-01',
          windowEnd: '2026-11-17',
          depth: 'advanced',
          credits: 2,
          results: 5,
          cached: false,
          passId: pass.id,
        },
        {
          kind: 'gap',
          slot: 'response',
          angle: 'action',
          query: 'q',
          normalizedQuery: 'q',
          windowStart: null,
          windowEnd: null,
          depth: 'basic',
          credits: 1,
          results: 3,
          cached: true,
          passId: pass.id,
        },
      ],
      dropped: [{ url: 'https://paywall.example/x', reason: 'unusable', passId: pass.id }],
    }

    expect(await prisma.$transaction(tx => storePassResult(tx, write(s.id, pass.id, pool, { version: version(1, pass.id), boxes: [box] })))).toBe(true)

    expect(strip(await loadPool(prisma, s.id))).toEqual(strip(pool))
    expect(await currentVersion(prisma, s.id)).toMatchObject({ ...version(1, pass.id), id: expect.any(String) })
    const row = await prisma.researchPass.findUniqueOrThrow({ where: { id: pass.id } })
    expect(row).toMatchObject({ status: 'completed', outcome: 'written', verdict: 'keep', costUsd: 0.132, tavilyCredits: 4, versionId: expect.any(String) })
    const boxes = await newestPassBoxes(prisma, s.id)
    expect(boxes.map(b => [b.type, b.place, b.passId])).toEqual([['compared', 'P1', pass.id]])
  })

  it('stores nothing for a pass a restart already marked as cut off', async () => {
    const s = await story()
    const pass = await createPass(s.id, 1)
    await prisma.researchPass.update({ where: { id: pass.id }, data: { status: 'failed' } })
    expect(await prisma.$transaction(tx => storePassResult(tx, write(s.id, pass.id, { ...emptyWith(source('S0')) })))).toBe(false)
    expect(await prisma.evidenceSource.count()).toBe(0)
  })

  it('keeps a fact once by its key, and records a later pass’s verdict, structure and demotion on the stored row', async () => {
    const s = await story()
    const first = await createPass(s.id, 1)
    const pool: Pool = { ...emptyWith(source('S0'), source('S1')), facts: [fact('S1F1'), fact('S1F2'), fact('S1F4')] }
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, first.id, pool)))

    const second = await createPass(s.id, 2)
    const loaded = await loadPool(prisma, s.id)
    const [f1, f2, f4] = loaded.facts
    const after: Pool = {
      ...loaded,
      facts: [
        { ...f1!, verdict: 'supported', checkedBy: { model: 'm', promptVersion: 'v', passId: second.id }, structured },
        {
          ...f2!,
          verdict: 'supported',
          verdictProblem: null,
          structured: { ...structured, asOf: '2026-10', valueHigh: 300, approx: 'about', creditedKind: null, credited: '', validity: 'fast' },
          status: 'demoted',
          drop: { passId: second.id, reason: 'contradicted', contradictedBy: ['S1F3', 'S1F5'] },
        },
        // Not among the changed refs: its stored row stays as it was
        { ...f4!, verdict: 'rejected', verdictProblem: 'Not stored.' },
        // The same fact found again under a new ref: the pool keeps the first
        fact('S1F9', { supportingSentence: f1!.supportingSentence, statement: f1!.statement }),
        fact('S1F3', { firstPassId: second.id }),
      ],
    }
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, second.id, after, { changed: ['S1F1', 'S1F2'] })))

    const facts = (await loadPool(prisma, s.id)).facts
    expect(facts.map(f => f.ref)).toEqual(['S1F1', 'S1F2', 'S1F4', 'S1F3'])
    expect(facts.slice(0, 2)).toEqual(after.facts.slice(0, 2))
    expect(facts[2]).toEqual(f4)
    expect(facts[0]).toMatchObject({ verdict: 'supported', checkedBy: { passId: second.id }, structured: { value: 212, by: structured.by } })
    expect(facts[1]).toMatchObject({ status: 'demoted', drop: { passId: second.id, reason: 'contradicted', contradictedBy: ['S1F3', 'S1F5'] } })
  })

  it("supersedes the story's current version with a pass's new one", async () => {
    const s = await story()
    const first = await createPass(s.id, 1)
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, first.id, emptyWith(source('S0')), { version: version(1, first.id) })))
    const second = await createPass(s.id, 2)
    const pool = await loadPool(prisma, s.id)
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, second.id, pool, { version: version(2, second.id) })))

    expect(await currentVersion(prisma, s.id)).toMatchObject({ number: 2, passId: second.id })
    const statuses = await prisma.articleVersion.findMany({ where: { storyId: s.id }, orderBy: { number: 'asc' }, select: { status: true } })
    expect(statuses.map(v => v.status)).toEqual(['superseded', 'current'])
  })

  it('numbers a new version after every earlier one, an undone update included, and reads every version back newest first', async () => {
    const s = await story()
    const passes = [await createPass(s.id, 1), await createPass(s.id, 2), await createPass(s.id, 3)]
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[0]!.id, emptyWith(source('S0')), { version: version(1, passes[0]!.id) })))
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[1]!.id, emptyWith(), { version: version(2, passes[1]!.id) })))
    // Version 2 undone: version 1 is current again, so the next pass's version follows it as number 2
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 2 }, data: { status: 'reverted' } })
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 1 }, data: { status: 'current' } })
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[2]!.id, emptyWith(), { version: version(2, passes[2]!.id) })))

    const versions = await storyVersions(prisma, s.id)
    expect(versions.map(v => [v.number, v.status, v.passId])).toEqual([
      [3, 'current', passes[2]!.id],
      [2, 'reverted', passes[1]!.id],
      [1, 'superseded', passes[0]!.id],
    ])
    expect(versions[0]).toMatchObject({
      article: version(2, null).article,
      note: version(2, null).note,
      changes: version(2, null).changes,
      createdAt: expect.any(Date),
    })
  })

  it("reads readers' versions apart: only those not reverted, newest first, with what Updates need, and the same Updates as from every version", async () => {
    const s = await story()
    const passes = [await createPass(s.id, 1), await createPass(s.id, 2), await createPass(s.id, 3)]
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[0]!.id, emptyWith(source('S0')), { version: version(1, passes[0]!.id) })))
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[1]!.id, emptyWith(), { version: version(2, passes[1]!.id) })))
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 2 }, data: { status: 'reverted' } })
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 1 }, data: { status: 'current' } })
    await prisma.$transaction(tx => storePassResult(tx, write(s.id, passes[2]!.id, emptyWith(), { version: version(2, passes[2]!.id) })))
    // A version whose projection no longer reads is left out, as `storyVersions` leaves it
    await prisma.articleVersion.create({ data: { storyId: s.id, number: 4, kind: 'update', status: 'superseded', research: { broken: true } } })

    const versions = await publicVersions(prisma, s.id)
    expect(versions.map(v => [v.number, v.kind, v.status])).toEqual([
      [3, 'update', 'current'],
      [1, 'first', 'superseded'],
    ])
    expect(Object.keys(versions[0]!).sort()).toEqual(['changes', 'createdAt', 'kind', 'note', 'number', 'research', 'status'])
    expect(versions[0]).toMatchObject({ note: version(2, null).note, changes: version(2, null).changes, research: version(2, null).research })
    expect(publicUpdates(versions)).toEqual(publicUpdates(await storyVersions(prisma, s.id)))
    expect(publicUpdates(versions)).toHaveLength(1)
  })

  it('reads a change stored before changes carried where the section was as at its own place', async () => {
    const s = await story()
    const before = { text: 'Old P.', citations: [] }
    await prisma.articleVersion.create({
      data: {
        storyId: s.id,
        number: 1,
        kind: 'update',
        status: 'current',
        research: version(1, null).research,
        changes: [{ section: 'Caveat 2', before, after: null }],
      },
    })
    expect((await storyVersions(prisma, s.id))[0]!.changes).toEqual([{ section: 'Caveat 2', from: 'Caveat 2', before, after: null }])
  })

  it('never holds two current versions of a story', async () => {
    const s = await story()
    const data = { storyId: s.id, kind: 'legacy' as const, status: 'current' as const, research: {} }
    await prisma.articleVersion.create({ data: { ...data, number: 1 } })
    await expect(prisma.articleVersion.create({ data: { ...data, number: 2 } })).rejects.toThrow()
  })

  it("reads the members' usable, structured page facts with their stories, never an earlier story's", async () => {
    const [a, b] = [await story(), await story()]
    const judged = (passId: string) => ({ verdict: 'supported' as const, checkedBy: { model: 'm', promptVersion: 'v', passId } })
    const passA = await createPass(a.id, 1)
    const poolA: Pool = {
      ...emptyWith(source('S0'), source('S1'), source('E1', { origin: 'earlier', earlierStoryId: b.id, url: '' })),
      facts: [
        fact('S0F1'),
        fact('S1F1', { structured, ...judged(passA.id) }),
        fact('S1F2', { structured, verdict: 'rejected', checkedBy: { model: 'm', promptVersion: 'v', passId: passA.id } }),
        fact('S1F3', judged(passA.id)),
        fact('E1F1', { structured, ...judged(passA.id) }),
      ],
    }
    await prisma.$transaction(tx => storePassResult(tx, write(a.id, passA.id, poolA)))
    const passB = await createPass(b.id, 1)
    const poolB: Pool = {
      ...emptyWith(source('S1')),
      facts: [fact('S1F1', { structured, ...judged(passB.id) }), fact('S1F2', { structured, ...judged(passB.id), status: 'demoted' })],
    }
    await prisma.$transaction(tx => storePassResult(tx, write(b.id, passB.id, poolB)))

    const facts = await loadMemberFacts(prisma, [a.id, b.id, a.id])
    expect(facts.map(f => [f.storyId === a.id ? 'a' : 'b', f.fact.ref, f.source.ref])).toEqual([
      ['a', 'S1F1', 'S1'],
      ['b', 'S1F1', 'S1'],
    ])
    expect(facts[0]!.fact.structured).toMatchObject({ value: 212, counted: 'deaths' })
    expect(await loadMemberFacts(prisma, [])).toEqual([])
  })
})

function emptyWith(...sources: PoolSource[]): Pool {
  return { sources, facts: [], searches: [], dropped: [] }
}
