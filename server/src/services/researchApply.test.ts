/**
 * Applying a research run and reverting it, with the database and the lifecycle write mocked: what
 * is written, against which status, and every refusal before anything is. The write itself, the
 * status fence and the snapshot rules on PostgreSQL are researchApply.db.test.ts's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { ConflictError, NotFoundError } from '../utils/errors.js'
import type { StoredResearch } from './researchRuns.js'
import type { ResearchSource } from './researchPipeline.js'

const mockPrisma = vi.hoisted(() => ({ story: { findUnique: vi.fn() }, storyResearchRun: { findUnique: vi.fn() } }))
vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
const mockRecord = vi.hoisted(() => vi.fn())
const mockTransition = vi.hoisted(() => vi.fn())
vi.mock('./storyLifecycle.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./storyLifecycle.js')>()),
  recordAnalysis: mockRecord,
  transition: mockTransition,
}))
const mockEmbed = vi.hoisted(() => vi.fn())
vi.mock('./embedding.js', () => ({ generateEmbeddingForContent: mockEmbed }))
const mockFavicons = vi.hoisted(() => vi.fn())
vi.mock('./sourceFavicons.js', () => ({ fetchSourceFaviconsInBackground: mockFavicons }))
// The owner's gate (RESEARCH_APPLY_ENABLED) and the research step's mode are read at startup; the key
// stays a getter on the real config
const applyGate = vi.hoisted(() => ({ enabled: true, mode: 'apply' as 'shadow' | 'apply' }))
vi.mock('../config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../config.js')>()
  Object.defineProperty(actual.config.research, 'applyEnabled', { get: () => applyGate.enabled })
  Object.defineProperty(actual.config.research.pipeline, 'mode', { get: () => applyGate.mode })
  return actual
})

const { applyResearchRun, applyRefusal, applyVerdict, pipelineMode, revertResearch } = await import('./researchApply.js')
const { buildResearchedStory } = await import('./researchedStory.js')

const STORY = 'story-1'
const RUN = 'run-1'
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
}
/** The story's own rating, which research never writes: the draft's rating differs. */
const rating = { relevance: 6, relevanceCalculation: '- **Scale:** 6' }

function source(id: string, over: Partial<ResearchSource> = {}): ResearchSource {
  return {
    id,
    origin: 'search',
    url: `https://www.outlet-${id.toLowerCase()}.example/a`,
    title: `Headline ${id}`,
    outlet: `Outlet ${id}`,
    date: '2026-11-10',
    favicon: `https://icons.example/${id}.png`,
    usedRawContent: false,
    kind: 'news-report',
    country: 'Kenya',
    relation: 'same-development',
    facts: [{ id: `${id}F1`, statement: `Fact of ${id}.`, supportingSentence: `Sentence of ${id}.`, measures: '', found: true }],
    voices: [],
    ...over,
  }
}

const draft = {
  titleLabel: 'Researched label',
  title: 'Researched headline',
  story: [{ text: 'Researched paragraph.', factIds: ['S0F1', 'S1F1', 'E1F1'] }],
  summary: 'Researched summary.',
  whyThisMatters: [{ text: 'It matters.', factIds: ['S1F1'] }],
  caveats: [{ text: 'A caveat.', factIds: [] }],
  quote: 'Researched quote',
  quoteAttribution: 'A minister',
  quoteSourceId: 'S1',
  marketingBlurb: 'Researched blurb.',
  relevanceCalculation: ['- **Scale:** 5'],
  rating: 5,
  oldNews: { isOld: false, firstHappened: 'unknown' },
  contradicted: { isContradicted: false, factIds: [] },
}

function result(over: Partial<StoredResearch> = {}): StoredResearch {
  return {
    storyId: STORY,
    calls: [],
    credits: 2,
    searches: [],
    candidates: 3,
    drops: {},
    sources: [source('S0', { origin: 'original' }), source('S1'), source('S2')],
    earlier: [
      {
        id: 'E1',
        storyId: 'story-e1',
        slug: 'earlier',
        title: 'Our earlier story',
        date: '2026-03-01',
        relation: 'earlier-development',
        facts: [{ id: 'E1F1', statement: 'Earlier.', supportingSentence: 'Earlier sentence.', measures: '', found: true }],
      },
    ],
    draft,
    rewritten: false,
    problems: [],
    checks: [{ problems: [], longestRuns: [], unjudged: [] }],
    failedOn: null,
    support: { facts: 3, found: 3 },
    optOutChecked: true,
    verdict: { kind: 'keep' },
    models: {} as StoredResearch['models'],
    prices: { models: {}, cacheWriteFactor: 1.25, tavilyUsdPerCredit: 0.008 },
    ...over,
  }
}

/** When the story was last written, as the apply or revert read it; the write is fenced on it. */
const READ_AT = new Date('2026-11-12T09:00:00Z')
const storyRow = (over: Record<string, unknown> = {}) => ({ status: 'published', preResearch: null, updatedAt: READ_AT, ...singleSource, ...rating, ...over })
const runRow = (over: Record<string, unknown> = {}) => ({ storyId: STORY, status: 'completed', result: result(), ...over })

/** The rows and expected statuses of the last lifecycle write. */
const lastWrite = () => {
  const [stage, actor, rows, expected] = mockRecord.mock.calls.at(-1)!
  return { stage, actor, row: rows[0], expected: [...(expected as Map<string, string>)] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv('TAVILY_API_KEY', 'tvly-test')
  applyGate.enabled = true
  applyGate.mode = 'apply'
  mockTransition.mockImplementation(async (ids: string[]) => ({ moved: ids, skipped: [] }))
  mockPrisma.story.findUnique.mockResolvedValue(storyRow())
  mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow())
  mockEmbed.mockResolvedValue(EMBEDDING)
  mockRecord.mockImplementation(async (_stage: string, _actor: string, rows: { id: string }[]) => new Map(rows.map(r => [r.id, 'refreshed'])))
  mockFavicons.mockResolvedValue(undefined)
})

describe('applyResearchRun', () => {
  it('writes the researched texts, the cited version and a snapshot of the single-source columns, with a fresh embedding, against the status and the last write read now; never the rating', async () => {
    await expect(applyResearchRun(STORY, RUN)).resolves.toBe('applied')

    const { stage, actor, row, expected } = lastWrite()
    expect([stage, actor, expected]).toEqual(['research', 'editor', [[STORY, 'published']]])
    // The draft rates the story 5; the story keeps its own 6 and its calculation (owner decision 2026-11-12)
    expect(row).toEqual({
      id: STORY,
      data: {
        title: 'Researched headline',
        titleLabel: 'Researched label',
        summary: 'Researched summary.',
        quote: 'Researched quote',
        quoteAttribution: 'A minister',
        marketingBlurb: 'Researched blurb.',
        relevanceReasons: '- It matters.',
        relevanceSummary: null,
        antifactors: '- A caveat.',
        research: buildResearchedStory(result()),
        preResearch: singleSource,
      },
      where: { updatedAt: READ_AT },
      embedding: EMBEDDING,
    })
    expect(mockEmbed).toHaveBeenCalledWith({
      title: 'Researched headline',
      titleLabel: 'Researched label',
      summary: 'Researched summary.',
      embeddingContentHash: null,
    })
  })

  it('keeps the first snapshot when the story already carries a researched version, so a revert returns to the single-source analysis', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(storyRow({ ...singleSource, title: 'An earlier run’s headline', preResearch: singleSource }))
    await applyResearchRun(STORY, RUN)
    expect(lastWrite().row.data.preResearch).toEqual(singleSource)
  })

  it("fetches the cited outlets' favicons after the write, each with the icon address search gave; none for our earlier stories", async () => {
    await applyResearchRun(STORY, RUN)

    expect(mockFavicons).toHaveBeenCalledWith([
      { host: 'outlet-s0.example', favicon: 'https://icons.example/S0.png' },
      { host: 'outlet-s1.example', favicon: 'https://icons.example/S1.png' },
    ])
    expect(mockFavicons.mock.invocationCallOrder[0]).toBeGreaterThan(mockRecord.mock.invocationCallOrder[0]!)
  })

  it.each([
    [
      'any run while research is switched off, so a killed switch puts no new research live',
      () => vi.stubEnv('TAVILY_API_KEY', ''),
      ConflictError,
      /switched off/,
    ],
    ['any run until the owner opens applying after the legal check', () => (applyGate.enabled = false), ConflictError, /RESEARCH_APPLY_ENABLED/],
    ['an unknown story', () => mockPrisma.story.findUnique.mockResolvedValue(null), NotFoundError, /Story not found/],
    ['an unknown run', () => mockPrisma.storyResearchRun.findUnique.mockResolvedValue(null), NotFoundError, /run not found/],
    ['a run of another story', () => mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ storyId: 'story-2' })), ConflictError, /another story/],
    [
      'a run still running',
      () => mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ status: 'running', result: null })),
      ConflictError,
      /this one is running/,
    ],
    [
      'a failed run',
      () => mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ status: 'failed', result: null })),
      ConflictError,
      /this one is failed/,
    ],
    [
      'a run without a draft',
      () => mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ result: result({ draft: null }) })),
      ConflictError,
      /no draft/,
    ],
    [
      "a run that fell back to today's format",
      () =>
        mockPrisma.storyResearchRun.findUnique.mockResolvedValue(
          runRow({ result: result({ verdict: { kind: 'fallback', reason: 'citation check', category: 'technical' } }) }),
        ),
      ConflictError,
      /fell back/,
    ],
    [
      'a draft an older write step stored without a part an apply needs',
      () => {
        const { marketingBlurb: _missing, ...older } = draft
        mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ result: { ...result(), draft: older } }))
      },
      ConflictError,
      /older format/,
    ],
    [
      'a draft written before 2026-11-13, cited per sentence and never checked for our own words',
      () => {
        const perSentence = { ...draft, story: [{ sentences: [{ text: 'Researched sentence.', factIds: ['S0F1'] }] }] }
        mockPrisma.storyResearchRun.findUnique.mockResolvedValue(runRow({ result: { ...result(), draft: perSentence } }))
      },
      ConflictError,
      /older format/,
    ],
    ['a trashed story', () => mockPrisma.story.findUnique.mockResolvedValue(storyRow({ status: 'trashed' })), ConflictError, /restore it first/],
    [
      'a story not yet analyzed',
      () => mockPrisma.story.findUnique.mockResolvedValue(storyRow({ status: 'pre_analyzed' })),
      ConflictError,
      /this one is pre_analyzed/,
    ],
  ])('refuses %s before any embedding or write', async (_name, arrange, kind, message) => {
    arrange()
    const attempt = applyResearchRun(STORY, RUN)
    await expect(attempt).rejects.toBeInstanceOf(kind)
    await expect(attempt).rejects.toThrow(message)
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })

  it('applies a run to a rejected story, which keeps its status', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(storyRow({ status: 'rejected' }))
    await expect(applyResearchRun(STORY, RUN)).resolves.toBe('applied')
    expect(lastWrite().expected).toEqual([[STORY, 'rejected']])
  })

  it("answers 409 when an editor's move or edit lands before the write, and fetches no favicon", async () => {
    mockRecord.mockResolvedValue(new Map([[STORY, 'skipped']]))
    await expect(applyResearchRun(STORY, RUN)).rejects.toThrow(/changed while this was written/)
    expect(mockFavicons).not.toHaveBeenCalled()
  })
})

describe('pipelineMode', () => {
  it('is apply only when the mode is apply and the owner has opened applying', () => {
    expect(pipelineMode()).toEqual({ mode: 'apply' })
    applyGate.mode = 'shadow'
    expect(pipelineMode()).toMatchObject({ mode: 'shadow' })
  })

  it('holds apply mode to shadow while applying is closed, and names the setting that holds it', () => {
    applyGate.enabled = false
    expect(pipelineMode()).toEqual({ mode: 'shadow', heldBack: 'RESEARCH_APPLY_ENABLED is not "true"' })
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(pipelineMode()).toEqual({ mode: 'shadow', heldBack: 'TAVILY_API_KEY is not set' })
  })
})

describe('applyVerdict', () => {
  const selectedRow = (over: Record<string, unknown> = {}) => storyRow({ status: 'selected', ...over })
  /** The story as the job read it before the run started. */
  const READ = { status: 'selected' as const, updatedAt: READ_AT }
  const LATER = new Date(READ_AT.getTime() + 60_000)
  const stale = { kind: 'stale', firstHappened: '2026-09-01' } as const

  beforeEach(() => {
    mockPrisma.story.findUnique.mockResolvedValue(selectedRow())
  })

  it("in apply mode, puts a kept run's version on the story as the pipeline, against the status and last write read before the run", async () => {
    await expect(applyVerdict(STORY, RUN, READ, result())).resolves.toBe('applied')

    const { stage, actor, row, expected } = lastWrite()
    expect([stage, actor, expected]).toEqual(['research', 'pipeline', [[STORY, 'selected']]])
    expect(row.data).toMatchObject({ title: 'Researched headline', research: buildResearchedStory(result()), preResearch: singleSource })
    expect(row.where).toEqual({ updatedAt: READ_AT })
    // Applied from the run's own result: the run is still running, so its row is never read
    expect(mockPrisma.storyResearchRun.findUnique).not.toHaveBeenCalled()
    expect(mockFavicons).toHaveBeenCalledTimes(1)
  })

  it('treats a run that rates the story below the bar as kept: it applies the researched version, rejects nothing, and the story keeps its rating', async () => {
    await expect(applyVerdict(STORY, RUN, READ, result({ verdict: { kind: 'research-rating', rating: 3 } }))).resolves.toBe('applied')
    expect(lastWrite().row.data).toMatchObject({ title: 'Researched headline', research: buildResearchedStory(result()) })
    expect(lastWrite().row.data).not.toHaveProperty('relevance')
    expect(lastWrite().row.data).not.toHaveProperty('relevanceCalculation')
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('leaves a story single-source on a below-the-bar run without a usable draft', async () => {
    await expect(applyVerdict(STORY, RUN, READ, result({ verdict: { kind: 'research-rating', rating: 3 }, draft: null }))).resolves.toBe('single-source')
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it.each([
    ['stale', stale, 'stale'],
    ['contradicted', { kind: 'contradicted', factIds: ['S1F1'] }, 'contradicted'],
  ] as const)(
    'in apply mode, rejects a %s verdict with its reason through the pipeline move, fenced on the last write read before the run',
    async (_name, verdict, reason) => {
      await expect(applyVerdict(STORY, RUN, READ, result({ verdict }))).resolves.toBe('rejected')
      expect(mockTransition).toHaveBeenCalledWith([STORY], { to: 'rejected', reason }, 'pipeline', { where: { updatedAt: READ_AT } })
      expect(mockRecord).not.toHaveBeenCalled()
    },
  )

  it('reports a rejection the fenced move skipped (an editor moved or edited the story just before it) as skipped', async () => {
    mockTransition.mockResolvedValue({ moved: [], skipped: [{ id: STORY, status: 'selected' }] })
    await expect(applyVerdict(STORY, RUN, READ, result({ verdict: stale }))).resolves.toBe('skipped')
  })

  it('leaves the story single-source on a fallback, and on a kept run without a usable draft', async () => {
    await expect(applyVerdict(STORY, RUN, READ, result({ verdict: { kind: 'fallback', reason: 'budget', category: 'technical' } }))).resolves.toBe(
      'single-source',
    )
    await expect(applyVerdict(STORY, RUN, READ, result({ draft: null }))).resolves.toBe('single-source')
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it.each<[string, Record<string, unknown> | null]>([
    ['an editor edited it', { updatedAt: LATER, title: 'An editor’s headline' }],
    ['an editor applied a run to it', { updatedAt: LATER, preResearch: singleSource }],
    ['an editor moved it', { status: 'published' }],
    ['it was deleted', null],
  ])('neither applies nor rejects when, during the run, %s: the editor’s state is kept', async (_name, row) => {
    mockPrisma.story.findUnique.mockResolvedValue(row && selectedRow(row))
    for (const verdict of [{ kind: 'keep' }, stale] as const) {
      await expect(applyVerdict(STORY, RUN, READ, result({ verdict }))).resolves.toBe('skipped')
    }
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
    expect(mockFavicons).not.toHaveBeenCalled()
  })

  const unknownKind = 'rumor' as ResearchSource['kind']
  it.each<[string, () => unknown, StoredResearch]>([
    ['the story changed during the embedding call', () => mockRecord.mockResolvedValue(new Map([[STORY, 'skipped']])), result()],
    ["the run's sources make no version readers can be given", () => undefined, result({ sources: [source('S0', { origin: 'original', kind: unknownKind })] })],
  ])('reports a kept run as skipped, without an error, when %s', async (_name, arrange, run) => {
    arrange()
    await expect(applyVerdict(STORY, RUN, READ, run)).resolves.toBe('skipped')
    expect(mockFavicons).not.toHaveBeenCalled()
  })

  it.each([
    ['shadow mode', () => (applyGate.mode = 'shadow')],
    ['apply mode while the owner’s gate is closed', () => (applyGate.enabled = false)],
  ])('as a backstop to its caller, applies no verdict in %s', async (_name, arrange) => {
    arrange()
    for (const verdict of [{ kind: 'keep' }, { kind: 'research-rating', rating: 3 }, { kind: 'fallback', reason: 'budget', category: 'technical' }] as const) {
      await expect(applyVerdict(STORY, RUN, READ, result({ verdict }))).resolves.toBe('shadow')
    }
    expect(mockPrisma.story.findUnique).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
  })
})

describe('revertResearch', () => {
  const researched = () => storyRow({ title: 'Researched headline', relevanceSummary: null, preResearch: singleSource, research: {} })

  it('writes the snapshot back and clears both versions, with an embedding of the restored text, against the status and the last write read now', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(researched())

    await revertResearch(STORY)

    const { stage, actor, row, expected } = lastWrite()
    expect([stage, actor, expected]).toEqual(['research', 'editor', [[STORY, 'published']]])
    // The rating is not research's to restore: it stays as it is
    expect(row).toEqual({
      id: STORY,
      data: { ...singleSource, research: Prisma.DbNull, preResearch: Prisma.DbNull },
      where: { updatedAt: READ_AT },
      embedding: EMBEDDING,
    })
    expect(mockEmbed).toHaveBeenCalledWith({
      title: singleSource.title,
      titleLabel: singleSource.titleLabel,
      summary: singleSource.summary,
      embeddingContentHash: null,
    })
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
    mockPrisma.story.findUnique.mockResolvedValue(researched())
    mockRecord.mockResolvedValue(new Map([[STORY, 'skipped']]))
    await expect(revertResearch(STORY)).rejects.toThrow(/changed while this was written/)
  })

  it.each([
    ['research is switched off', () => vi.stubEnv('TAVILY_API_KEY', '')],
    ['applying is closed', () => (applyGate.enabled = false)],
  ])('still reverts while %s, so a story can always be taken back', async (_name, close) => {
    close()
    mockPrisma.story.findUnique.mockResolvedValue(researched())
    await expect(revertResearch(STORY)).resolves.toBeUndefined()
    expect(mockRecord).toHaveBeenCalledTimes(1)
  })
})

describe('applyRefusal', () => {
  it('is null while research is on and the owner has opened applying', () => {
    expect(applyRefusal()).toBeNull()
  })

  it('names the missing key first, then the closed gate', () => {
    applyGate.enabled = false
    expect(applyRefusal()).toMatch(/RESEARCH_APPLY_ENABLED/)
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(applyRefusal()).toMatch(/TAVILY_API_KEY/)
  })
})
