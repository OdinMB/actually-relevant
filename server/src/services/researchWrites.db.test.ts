/**
 * The story's research writes on PostgreSQL that research passes keep: undoing the current update
 * puts the version before it back on the story and takes its Update off the list; reverting to the
 * single-source analysis restores the snapshot and reverts every version; an edit made meanwhile and
 * every refusal leave everything as it was. The embedding call and the favicon fetch are mocked.
 */
import { randomUUID } from 'node:crypto'
import { it, expect, vi, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, embeddingHash, useTestDatabase } from '../test/db/harness.js'
import { publicUpdates, versionArticle } from './articleVersions.js'
import { currentVersion, loadPool, publicVersions } from './passRecords.js'
import { insertPoolRows, insertVersion } from './passWrites.js'
import { rewriteTargets } from './researchPassUpdate.js'
import type { Article, ArticleVersionData, PoolFact, PoolSource } from './researchPool.js'
import type { ResearchedStory } from './researchedStory.js'

const mockGenerate = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({
  generateEmbeddingForContent: mockGenerate,
  generateSearchEmbedding: vi.fn(),
  ensureEmbedding: vi.fn(),
  ensureEmbeddings: vi.fn(),
}))
vi.mock('./sourceFavicons.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./sourceFavicons.js')>()),
  fetchSourceFaviconsInBackground: vi.fn(),
}))
const mockForget = vi.hoisted(() => vi.fn())
vi.mock('./relatedStories.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./relatedStories.js')>()),
  forgetRelatedStories: mockForget,
}))

const { revertResearch, undoUpdate } = await import('./researchWrites.js')

const SINGLE_SOURCE = {
  title: 'Single-source headline',
  titleLabel: 'Single label',
  summary: 'Single-source summary.',
  quote: null,
  quoteAttribution: null,
  marketingBlurb: 'Outlet reports a development.',
  relevanceReasons: '- single',
  relevanceSummary: 'Why it matters, from one source.',
  antifactors: '- single limit',
  emotionTag: 'frustrating' as const,
}

const projection = (text: string): ResearchedStory => ({
  paragraphs: [{ sentences: [{ text, citations: [{ sourceId: 'S1', sentence: 'Sentence.' }] }] }],
  whyThisMatters: [],
  caveats: [],
  quoteSourceId: null,
  sources: [],
})

const version = (number: number, status: ArticleVersionData['status']): ArticleVersionData => ({
  id: null,
  number,
  kind: number === 1 ? 'first' : 'update',
  status,
  passId: null,
  title: `Headline v${number}`,
  titleLabel: 'Label',
  summary: `Summary v${number}.`,
  marketingBlurb: `Blurb v${number}.`,
  quote: null,
  quoteAttribution: null,
  relevanceReasons: `- Point v${number}.`,
  antifactors: '- Caveat.',
  emotionTag: 'uplifting',
  research: projection(`Paragraph v${number}.`),
  article: null,
  changes:
    number === 1
      ? []
      : [{ section: 'Story paragraph 1', from: 'Story paragraph 1', before: projection('Paragraph v1.').paragraphs[0]!.sentences[0]!, after: null }],
  note: number === 1 ? null : { text: `Update ${number}.`, citations: [] },
})

/** An article whose one paragraph cites `factIds`. */
const citing = (factIds: string[]): Article => ({
  titleLabel: 'Label',
  title: 'Headline v1',
  story: [{ text: 'Paragraph v1.', factIds }],
  summary: 'Summary v1.',
  whyThisMatters: [{ text: 'Point v1.', factIds: [] }],
  caveats: [{ text: 'Caveat.', factIds: [] }],
  quote: '',
  quoteAttribution: '',
  quoteSourceId: '',
  marketingBlurb: 'Blurb v1.',
  emotionTag: 'uplifting',
})

const poolSource = (ref: string): PoolSource => ({
  id: null,
  ref,
  origin: 'search',
  earlierStoryId: null,
  url: `https://${ref.toLowerCase()}.example/story`,
  outlet: `Outlet ${ref}`,
  title: `Title ${ref}`,
  date: '2026-11-12',
  kind: 'news-report',
  country: '',
  relation: 'same-development',
  favicon: null,
  usedRawContent: false,
  voices: [],
  optOutChecked: true,
  firstPassId: null,
})

const poolFact = (ref: string, extra: Partial<PoolFact>): PoolFact => ({
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
  verdict: 'supported',
  verdictProblem: null,
  checkedBy: null,
  status: 'unreviewed',
  firstPassId: null,
  drop: null,
  ...extra,
})

let feedId = ''

/** A published story researched into version `current` of the versions given, its columns that version's. */
async function researched(versions: ArticleVersionData[]) {
  const s = await createStory({ feedId, status: 'published', slug: `story-${randomUUID()}`, datePublished: new Date() })
  const shown = versions.find(v => v.status === 'current')!
  await prisma.story.update({
    where: { id: s.id },
    data: {
      title: shown.title,
      titleLabel: shown.titleLabel,
      summary: shown.summary,
      marketingBlurb: shown.marketingBlurb,
      relevanceReasons: shown.relevanceReasons,
      antifactors: shown.antifactors,
      relevanceSummary: null,
      emotionTag: 'uplifting',
      research: shown.research,
      preResearch: SINGLE_SOURCE,
    },
  })
  // Inserted current one by one, the older ones then set back to their status
  for (const v of versions) {
    const id = await prisma.$transaction(async tx => {
      await tx.articleVersion.updateMany({ where: { storyId: s.id, status: 'current' }, data: { status: 'superseded' } })
      return insertVersion(tx, s.id, v)
    })
    await prisma.articleVersion.update({ where: { id }, data: { status: v.status } })
  }
  return s
}

const statuses = async (storyId: string) =>
  (await prisma.articleVersion.findMany({ where: { storyId }, orderBy: { number: 'asc' }, select: { status: true } })).map(v => v.status)

describeDb("the story's research writes (PostgreSQL)", () => {
  useTestDatabase()

  beforeEach(async () => {
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(3), hash: 'restored' })
    mockForget.mockReset()
    feedId = (await createFeed((await createIssue()).id)).id
  })

  it('undoes the current update: the version before it goes back on the story, the update is reverted, and its Update leaves the list', async () => {
    const s = await researched([version(1, 'superseded'), version(2, 'superseded'), version(3, 'current')])
    expect(publicUpdates(await publicVersions(prisma, s.id)).map(u => u.note.text)).toEqual(['Update 3.', 'Update 2.'])

    await undoUpdate(s.id)

    expect(await prisma.story.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      status: 'published',
      title: 'Headline v2',
      summary: 'Summary v2.',
      relevanceReasons: '- Point v2.',
      research: projection('Paragraph v2.'),
      // The single-source snapshot stays for a revert
      preResearch: SINGLE_SOURCE,
    })
    expect(await statuses(s.id)).toEqual(['superseded', 'current', 'reverted'])
    expect(publicUpdates(await publicVersions(prisma, s.id)).map(u => u.note.text)).toEqual(['Update 2.'])
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Headline v2', summary: 'Summary v2.' }))

    // Undone again, the first version is current, and nothing is left to undo
    await undoUpdate(s.id)
    expect(await statuses(s.id)).toEqual(['current', 'reverted', 'reverted'])
    expect(publicUpdates(await publicVersions(prisma, s.id))).toEqual([])
    await expect(undoUpdate(s.id)).rejects.toMatchObject({ status: 409 })
  })

  it("restores the facts the undone update demoted, so a later pass with no fresh facts rewrites nothing; another pass's demotions stay", async () => {
    const s = await researched([{ ...version(1, 'superseded'), article: citing(['S1F1']) }, version(2, 'current')])
    const [p1, p2] = await Promise.all(
      [1, 2].map(n => prisma.researchPass.create({ data: { storyId: s.id, number: n, trigger: 'editor', kind: n === 1 ? 'first' : 'later', costUsd: 0.4 } })),
    )
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 1 }, data: { passId: p1!.id } })
    await prisma.articleVersion.updateMany({ where: { storyId: s.id, number: 2 }, data: { passId: p2!.id } })
    const demotedBy = (passId: string) => ({ status: 'demoted' as const, drop: { passId, reason: 'contradicted' as const, contradictedBy: ['S2F1'] } })
    await prisma.$transaction(tx =>
      insertPoolRows(tx, s.id, {
        searches: [],
        dropped: [],
        sources: [poolSource('S1')],
        facts: [poolFact('S1F1', demotedBy(p2!.id)), poolFact('S1F2', demotedBy(p1!.id))],
      }),
    )

    await undoUpdate(s.id)

    const pool = await loadPool(prisma, s.id)
    expect(pool.facts.find(f => f.ref === 'S1F1')).toMatchObject({ status: 'unreviewed', drop: null })
    expect(pool.facts.find(f => f.ref === 'S1F2')).toMatchObject({ status: 'demoted', drop: { passId: p1!.id } })
    // The restored version's paragraph cites the restored fact: with nothing found since, no section is a target
    const restored = (await currentVersion(prisma, s.id))!
    const demoted = new Map(pool.facts.filter(f => f.status === 'demoted').map(f => [f.ref, 'contradicted']))
    expect(rewriteTargets(versionArticle(restored, pool), [], { fresh: new Set(), demoted }).targets).toEqual([])
  })

  it('refuses an undo with no update to undo, changing nothing', async () => {
    const s = await researched([version(1, 'current')])
    await expect(undoUpdate(s.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Only an update') })
    expect(await statuses(s.id)).toEqual(['current'])
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('a revert restores every snapshot field, clears both versions, reverts every version, regenerates the embedding and forgets the related stories; an edited rating stays', async () => {
    const s = await researched([version(1, 'superseded'), version(2, 'current')])
    // The rating is no swapped field: an editor may change it on a researched story
    await prisma.story.update({ where: { id: s.id }, data: { relevance: 7 } })

    await revertResearch(s.id)

    expect(await prisma.story.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
      ...SINGLE_SOURCE,
      relevance: 7,
      status: 'published',
      research: null,
      preResearch: null,
    })
    expect(await statuses(s.id)).toEqual(['reverted', 'reverted'])
    expect(publicUpdates(await publicVersions(prisma, s.id))).toEqual([])
    expect(await embeddingHash(s.id)).toBe('restored')
    expect(mockForget).toHaveBeenCalledWith([s.id])
  })

  it('an edit saved while the revert makes its embedding is kept: the story stays researched, its versions as they were, and the revert answers 409', async () => {
    const s = await researched([version(1, 'current')])
    // As read before the edit, so the edit moves updatedAt on even within one millisecond
    await prisma.story.update({ where: { id: s.id }, data: { updatedAt: new Date('2026-01-01T00:00:00Z') } })
    mockGenerate.mockImplementationOnce(async () => {
      await prisma.story.update({ where: { id: s.id }, data: { emotionTag: 'calm' } })
      return { embedding: axisVector(3), hash: 'restored' }
    })

    await expect(revertResearch(s.id)).rejects.toThrow(/changed while this was written/)

    const after = await prisma.story.findUniqueOrThrow({ where: { id: s.id } })
    expect(after).toMatchObject({ title: 'Headline v1', emotionTag: 'calm' })
    expect(after.preResearch).toEqual(SINGLE_SOURCE)
    expect(await statuses(s.id)).toEqual(['current'])
  })

  it('refuses a revert of a story without a researched version', async () => {
    const s = await createStory({ feedId, status: 'published', slug: `story-${randomUUID()}`, datePublished: new Date() })
    await expect(revertResearch(s.id)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/no researched version/) })
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
