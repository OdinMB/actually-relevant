import { describe, it, expect, vi, beforeEach } from 'vitest'

// The apply itself (gate, refusals, the fenced write) is researchApply's, and which run is newest is
// researchRuns' (the db test); here, which run each story of a batch takes, the skips with their
// reasons, the order, and the outcome of each story.
const mockPrisma = vi.hoisted(() => ({ story: { findUnique: vi.fn() } }))
const mockRuns = vi.hoisted(() => ({ newestResearchRun: vi.fn() }))
const mockApply = vi.hoisted(() => ({ applyResearchRun: vi.fn(), applyRefusal: vi.fn() }))

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }))
vi.mock('./researchRuns.js', async importOriginal => ({
  ...(await importOriginal<typeof import('./researchRuns.js')>()),
  ...mockRuns,
}))
vi.mock('./researchApply.js', () => mockApply)

const { applyNewestRuns } = await import('./researchApplyBatch.js')
const { researchedValues } = await import('./researchSwap.js')
const { taskRegistry } = await import('../lib/taskRegistry.js')
const { ConflictError, NotFoundError } = await import('../utils/errors.js')

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

const draft = {
  titleLabel: 'Researched label',
  title: 'Researched headline',
  story: [{ text: 'Researched paragraph.', factIds: ['S0F1', 'S1F1'] }],
  summary: 'Researched summary.',
  whyThisMatters: [{ text: 'It matters.', factIds: ['S1F1'] }],
  caveats: [{ text: 'A caveat.', factIds: [] }],
  quote: 'Researched quote',
  quoteAttribution: 'A minister',
  quoteSourceId: 'S1',
  marketingBlurb: 'Researched blurb.',
  emotionTag: 'uplifting' as const,
  relevanceCalculation: ['- **Scale:** 5'],
  rating: 5,
}

/** A story's newest run as the admin lists it; a completed run research kept, with its draft. */
const run = (id: string, over: Record<string, unknown> = {}, result: Record<string, unknown> = {}) => ({
  id,
  status: 'completed',
  error: null,
  result: { draft, verdict: { kind: 'keep' }, ...result },
  ...over,
})

/** A single-source story: no snapshot, its own texts. */
const singleSourceStory = { preResearch: null, ...singleSource }

beforeEach(() => {
  vi.clearAllMocks()
  taskRegistry.clear()
  mockApply.applyRefusal.mockReturnValue(null)
  mockApply.applyResearchRun.mockResolvedValue('applied')
  mockPrisma.story.findUnique.mockResolvedValue(singleSourceStory)
  mockRuns.newestResearchRun.mockImplementation(async (storyId: string) => run(`run-${storyId}`))
})

describe('applyNewestRuns', () => {
  it("puts each story's newest run on it through the single apply, one story at a time in the order chosen", async () => {
    const releases: (() => void)[] = []
    mockApply.applyResearchRun.mockImplementation(() => new Promise(resolve => releases.push(() => resolve('applied'))))

    const done = applyNewestRuns(['s1', 's2'])

    await vi.waitFor(() => expect(mockApply.applyResearchRun).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mockApply.applyResearchRun).toHaveBeenCalledTimes(1)
    releases[0]!()
    await vi.waitFor(() => expect(mockApply.applyResearchRun).toHaveBeenCalledTimes(2))
    releases[1]!()

    expect(await done).toEqual({
      outcomes: [
        { storyId: 's1', outcome: 'applied', runId: 'run-s1', verdict: 'keep' },
        { storyId: 's2', outcome: 'applied', runId: 'run-s2', verdict: 'keep' },
      ],
    })
    expect(mockApply.applyResearchRun.mock.calls).toEqual([
      ['s1', 'run-s1'],
      ['s2', 'run-s2'],
    ])
  })

  it('refuses the whole batch while no run can be applied, reading and applying nothing', async () => {
    mockApply.applyRefusal.mockReturnValue('Applying research is not open yet: RESEARCH_APPLY_ENABLED is not "true"')

    await expect(applyNewestRuns(['s1'])).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/RESEARCH_APPLY_ENABLED/) })
    expect(mockPrisma.story.findUnique).not.toHaveBeenCalled()
    expect(mockApply.applyResearchRun).not.toHaveBeenCalled()
  })

  // The story's research section opens on its newest run and offers "Use this version" only for a
  // completed run with a draft that did not fall back; an older run is never reached for
  it.each([
    ['no run', null, /no research run/i],
    ['a newest run still running', run('r', { status: 'running', result: null }), /still running/],
    [
      'a newest run that failed',
      run('r', { status: 'failed', error: 'interrupted: the server restarted during the run', result: null }),
      /failed.*interrupted/,
    ],
    ['a newest run that fell back', run('r', {}, { verdict: { kind: 'fallback', reason: 'no usable source', category: 'no_other_coverage' } }), /fell back/],
    ['a newest run without a draft', run('r', {}, { draft: null }), /no draft/],
  ])('skips a story with %s, with the reason, and applies the others', async (_name, newest, reason) => {
    mockRuns.newestResearchRun.mockImplementation(async (storyId: string) => (storyId === 's1' ? newest : run(`run-${storyId}`)))

    const { outcomes } = await applyNewestRuns(['s1', 's2'])

    expect(outcomes).toEqual([
      { storyId: 's1', outcome: 'skipped', reason: expect.stringMatching(reason) },
      { storyId: 's2', outcome: 'applied', runId: 'run-s2', verdict: 'keep' },
    ])
    expect(mockApply.applyResearchRun).toHaveBeenCalledTimes(1)
    expect(mockApply.applyResearchRun).toHaveBeenCalledWith('s2', 'run-s2')
  })

  it('skips a story that already shows its newest run, writing nothing', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ preResearch: singleSource, ...singleSource, ...researchedValues(draft) })

    const { outcomes } = await applyNewestRuns(['s1'])

    expect(outcomes).toEqual([{ storyId: 's1', outcome: 'skipped', reason: expect.stringMatching(/already applied/) }])
    expect(mockApply.applyResearchRun).not.toHaveBeenCalled()
  })

  it("puts the newest run on a story that shows an older run's version", async () => {
    const older = researchedValues({ ...draft, title: 'An older researched headline' })
    mockPrisma.story.findUnique.mockResolvedValue({ preResearch: singleSource, ...singleSource, ...older })

    const { outcomes } = await applyNewestRuns(['s1'])

    expect(outcomes).toEqual([{ storyId: 's1', outcome: 'applied', runId: 'run-s1', verdict: 'keep' }])
  })

  it("does not take a single-source story for one showing the run's version, even with the same texts", async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ preResearch: null, ...singleSource, ...researchedValues(draft) })

    expect((await applyNewestRuns(['s1'])).outcomes).toEqual([{ storyId: 's1', outcome: 'applied', runId: 'run-s1', verdict: 'keep' }])
  })

  it("skips a story the apply refuses, with the apply's own reason: an older format, the status, a story that changed", async () => {
    const refusals: Record<string, Error> = {
      s1: new ConflictError('This run is from an older format and cannot be applied; research the story again'),
      s2: new ConflictError('A trashed story cannot take a researched version: restore it first'),
      s3: new NotFoundError('Story not found'),
    }
    mockApply.applyResearchRun.mockImplementation(async (storyId: string) => {
      if (refusals[storyId]) throw refusals[storyId]
      return 'applied'
    })
    // A draft of the older format still goes to the apply, which refuses it so
    mockRuns.newestResearchRun.mockImplementation(async (storyId: string) =>
      run(`run-${storyId}`, {}, storyId === 's1' ? { draft: { story: [{ sentences: [] }] } } : {}),
    )

    const { outcomes } = await applyNewestRuns(['s1', 's2', 's3', 's4'])

    expect(outcomes).toEqual([
      { storyId: 's1', outcome: 'skipped', reason: 'This run is from an older format and cannot be applied; research the story again' },
      { storyId: 's2', outcome: 'skipped', reason: 'A trashed story cannot take a researched version: restore it first' },
      { storyId: 's3', outcome: 'skipped', reason: 'Story not found' },
      { storyId: 's4', outcome: 'applied', runId: 'run-s4', verdict: 'keep' },
    ])
  })

  it('skips an unknown story before reading its runs', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)

    expect((await applyNewestRuns(['s1'])).outcomes).toEqual([{ storyId: 's1', outcome: 'skipped', reason: 'Story not found' }])
    expect(mockRuns.newestResearchRun).not.toHaveBeenCalled()
  })

  // As "Use this version": an editor may overrule research's verdict, and the story is not rejected
  it.each(['stale', 'contradicted', 'research-rating'] as const)('puts a newest run research judged %s on the story, saying so', async kind => {
    mockRuns.newestResearchRun.mockResolvedValue(run('run-1', {}, { verdict: { kind } }))

    expect((await applyNewestRuns(['s1'])).outcomes).toEqual([{ storyId: 's1', outcome: 'applied', runId: 'run-1', verdict: kind }])
  })

  it('counts an unexpected error as that story failing, by its name only, and goes on', async () => {
    mockApply.applyResearchRun.mockImplementation(async (storyId: string) => {
      if (storyId === 's1') throw new Error('embedding call failed for "Researched headline"')
      return 'applied'
    })

    const { outcomes } = await applyNewestRuns(['s1', 's2'])

    expect(outcomes).toEqual([
      { storyId: 's1', outcome: 'failed', reason: 'unexpected error (Error)' },
      { storyId: 's2', outcome: 'applied', runId: 'run-s2', verdict: 'keep' },
    ])
  })

  it('skips the stories another task is processing, and takes a story chosen twice once', async () => {
    taskRegistry.create('assess', 1, ['s1'])

    const { outcomes } = await applyNewestRuns(['s1', 's2', 's2'])

    expect(outcomes).toEqual([
      { storyId: 's1', outcome: 'skipped', reason: expect.stringMatching(/already being processed/i) },
      { storyId: 's2', outcome: 'applied', runId: 'run-s2', verdict: 'keep' },
    ])
    expect(mockApply.applyResearchRun).toHaveBeenCalledTimes(1)
  })
})
