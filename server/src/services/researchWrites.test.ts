/**
 * Reverting a story to its single-source analysis, with the database and the lifecycle write mocked:
 * what is written, against which status, and every refusal before anything is. The same write on
 * PostgreSQL, the undo and the version hooks are researchWrites.db.test.ts's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const mockPrisma = vi.hoisted(() => ({ story: { findUnique: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
const mockRecord = vi.hoisted(() => vi.fn())
vi.mock('./storyLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./storyLifecycle.js')>()),
  recordAnalysis: mockRecord,
}))
const mockEmbed = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({ generateEmbeddingForContent: mockEmbed }))
vi.mock('./sourceFavicons.js', () => ({ fetchSourceFaviconsInBackground: vi.fn() }))

const { revertResearch } = await import('./researchWrites.js')

const STORY = 'story-1'
const EMBEDDING = { embedding: [0.1, 0.2], hash: 'h' }

/** The swapped columns before research: what the snapshot holds and a revert writes back. */
const singleSource = {
  title: 'Single-source headline',
  titleLabel: 'Label',
  summary: 'Single-source summary.',
  quote: 'A quote',
  quoteAttribution: 'Original article',
  marketingBlurb: 'Outlet reports …',
  relevanceReasons: '- **Reason:** single',
  relevanceSummary: 'Why it matters, single-source.',
  antifactors: '- **Limit:** single',
  emotionTag: 'frustrating',
}
/** A snapshot an apply stored before the emotion tag was swapped (2026-11-14). */
const { emotionTag: _untagged, ...untaggedSnapshot } = singleSource
/** The story's own rating, which research never writes. */
const rating = { relevance: 6, relevanceCalculation: '- **Scale:** 6' }

/** When the story was last written, as the revert read it; the write is fenced on it. */
const READ_AT = new Date('2026-11-12T09:00:00Z')
const storyRow = (over: Record<string, unknown> = {}) => ({ status: 'published', preResearch: null, updatedAt: READ_AT, ...singleSource, ...rating, ...over })
const researched = () => storyRow({ title: 'Researched headline', relevanceSummary: null, emotionTag: 'uplifting', preResearch: singleSource, research: {} })

/** The rows and expected statuses of the last lifecycle write. */
const lastWrite = () => {
  const [stage, actor, rows, expected] = mockRecord.mock.calls.at(-1)!
  return { stage, actor, row: rows[0], expected: [...(expected as Map<string, string>)] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
  mockPrisma.story.findUnique.mockResolvedValue(researched())
  mockEmbed.mockResolvedValue(EMBEDDING)
  mockRecord.mockImplementation(async (_stage: string, _actor: string, rows: { id: string }[]) => new Map(rows.map(r => [r.id, 'refreshed'])))
})

describe('revertResearch', () => {
  it('writes the snapshot back, the single-source emotion tag included, and clears both versions, with an embedding of the restored text, against the status and the last write read now', async () => {
    await revertResearch(STORY)

    const { stage, actor, row, expected } = lastWrite()
    expect([stage, actor, expected]).toEqual(['research', 'editor', [[STORY, 'published']]])
    // The rating is not research's to restore: it stays as it is
    expect(row).toEqual({
      id: STORY,
      data: { ...singleSource, research: Prisma.DbNull, preResearch: Prisma.DbNull },
      where: { updatedAt: READ_AT },
      embedding: EMBEDDING,
      also: expect.any(Function),
    })
    // In the same transaction, every article version is reverted
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    await row.also!({ articleVersion: { updateMany } } as never)
    expect(updateMany).toHaveBeenCalledWith({ where: { storyId: STORY, status: { not: 'reverted' } }, data: { status: 'reverted' } })
    expect(mockEmbed).toHaveBeenCalledWith({
      title: singleSource.title,
      titleLabel: singleSource.titleLabel,
      summary: singleSource.summary,
      embeddingContentHash: null,
    })
  })

  it('leaves the emotion tag alone on a story whose snapshot was stored before the tag was swapped', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ ...researched(), preResearch: untaggedSnapshot })
    await revertResearch(STORY)
    expect(lastWrite().row.data).toEqual({ ...untaggedSnapshot, research: Prisma.DbNull, preResearch: Prisma.DbNull })
  })

  it.each([
    ['an unknown story', () => mockPrisma.story.findUnique.mockResolvedValue(null), NotFoundError, /Story not found/],
    ['a story without a researched version', () => mockPrisma.story.findUnique.mockResolvedValue(storyRow()), ConflictError, /no researched version/],
    ['a trashed story', () => mockPrisma.story.findUnique.mockResolvedValue({ ...researched(), status: 'trashed' }), ConflictError, /restore it first/],
    [
      'a snapshot that cannot be read',
      () => mockPrisma.story.findUnique.mockResolvedValue({ ...researched(), preResearch: { title: 'only a title' } }),
      ConflictError,
      /re-assess/,
    ],
  ])('refuses %s before any embedding or write', async (_name, arrange, kind, message) => {
    arrange()
    const attempt = revertResearch(STORY)
    await expect(attempt).rejects.toBeInstanceOf(kind)
    await expect(attempt).rejects.toThrow(message)
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it("answers 409 when an editor's move or edit lands before the write", async () => {
    mockRecord.mockResolvedValue(new Map([[STORY, 'skipped']]))
    await expect(revertResearch(STORY)).rejects.toThrow(/changed while this was written/)
  })

  it('still reverts while research is switched off, so a story can always be taken back', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    await expect(revertResearch(STORY)).resolves.toBeUndefined()
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})
