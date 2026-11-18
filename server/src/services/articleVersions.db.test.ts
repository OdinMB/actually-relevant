/**
 * Article versions on PostgreSQL: undoing the current update puts the version before it back on the
 * story and takes its Update off the list; reverting to the single-source analysis reverts every
 * version; refusals leave everything as it was. The embedding call and the favicon fetch are mocked.
 */
import { randomUUID } from 'node:crypto'
import { it, expect, vi, beforeEach } from 'vitest'
import prisma from '../lib/prisma.js'
import { axisVector, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { publicUpdates } from './articleVersions.js'
import { insertVersion, storyVersions } from './passRecords.js'
import type { ArticleVersionData } from './researchPool.js'
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

const { revertResearch, undoUpdate } = await import('./researchApply.js')

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
  changes: number === 1 ? [] : [{ section: 'Story paragraph 1', before: projection('Paragraph v1.').paragraphs[0]!.sentences[0]!, after: null }],
  note: number === 1 ? null : { text: `Update ${number}.`, citations: [] },
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

describeDb('article versions (PostgreSQL)', () => {
  useTestDatabase()

  beforeEach(async () => {
    mockGenerate.mockReset().mockResolvedValue({ embedding: axisVector(3), hash: 'restored' })
    feedId = (await createFeed((await createIssue()).id)).id
  })

  it('undoes the current update: the version before it goes back on the story, the update is reverted, and its Update leaves the list', async () => {
    const s = await researched([version(1, 'superseded'), version(2, 'superseded'), version(3, 'current')])
    expect(publicUpdates(await storyVersions(prisma, s.id)).map(u => u.note.text)).toEqual(['Update 3.', 'Update 2.'])

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
    expect(publicUpdates(await storyVersions(prisma, s.id)).map(u => u.note.text)).toEqual(['Update 2.'])
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ title: 'Headline v2', summary: 'Summary v2.' }))

    // Undone again, the first version is current, and nothing is left to undo
    await undoUpdate(s.id)
    expect(await statuses(s.id)).toEqual(['current', 'reverted', 'reverted'])
    expect(publicUpdates(await storyVersions(prisma, s.id))).toEqual([])
    await expect(undoUpdate(s.id)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses an undo with no update to undo, changing nothing', async () => {
    const s = await researched([version(1, 'current')])
    await expect(undoUpdate(s.id)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Only an update') })
    expect(await statuses(s.id)).toEqual(['current'])
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('reverts every version when the story goes back to its single-source analysis', async () => {
    const s = await researched([version(1, 'superseded'), version(2, 'current')])
    await revertResearch(s.id)
    expect(await prisma.story.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ title: SINGLE_SOURCE.title, research: null, preResearch: null })
    expect(await statuses(s.id)).toEqual(['reverted', 'reverted'])
    expect(publicUpdates(await storyVersions(prisma, s.id))).toEqual([])
  })
})
