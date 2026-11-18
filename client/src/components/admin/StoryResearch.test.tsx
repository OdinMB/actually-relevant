import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  ArticleVersionView,
  EmotionTag,
  PassUsage,
  ResearchPass,
  ResearchResult,
  ResearchRun,
  ResearchUsage,
  ResearchVerdict,
  Story,
  StoryPasses,
} from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'

const mockResearch = vi.hoisted(() => ({ usage: vi.fn(), runs: vi.fn(), start: vi.fn(), apply: vi.fn(), revert: vi.fn() }))
const mockStories = vi.hoisted(() => ({ taskStatus: vi.fn() }))
const mockPasses = vi.hoisted(() => ({ usage: vi.fn(), story: vi.fn(), undo: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { research: mockResearch, stories: mockStories, researchPasses: mockPasses },
}))

import { ApiError } from '../../lib/admin-api'
import { singleSourceEmotion, StoryResearch } from './StoryResearch'

const usage = (over: Partial<ResearchUsage> = {}): ResearchUsage => ({
  enabled: true,
  refusal: null,
  applyRefusal: null,
  monthToDateUsd: 1.5,
  monthlyCapUsd: 30,
  reservationUsd: 0.25,
  ...over,
})

function renderSection(status = 'analyzed', preResearch: Record<string, unknown> | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BackgroundTaskProvider>
          <StoryResearch story={{ id: 'story-1', status: status as 'analyzed', emotionTag: 'calm', preResearch }} />
        </BackgroundTaskProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return client
}

/** A stored result with a draft, as a completed run has. */
function researchResult(verdict: ResearchVerdict): ResearchResult {
  return {
    storyId: 'story-1',
    calls: [],
    credits: 2,
    searches: [],
    candidates: 1,
    drops: {},
    sources: [],
    earlier: [],
    draft: {
      titleLabel: 'Label',
      title: 'Researched headline',
      story: [{ text: 'A paragraph.', factIds: [] }],
      summary: 'Summary.',
      whyThisMatters: [],
      caveats: [],
      quote: '',
      quoteAttribution: '',
      quoteSourceId: 'S0',
      marketingBlurb: 'Blurb.',
      emotionTag: 'uplifting',
      relevanceCalculation: [],
      rating: 5,
      oldNews: { isOld: false, firstHappened: 'unknown' },
      contradicted: { isContradicted: false, factIds: [] },
    },
    rewritten: false,
    problems: [],
    support: { facts: 0, found: 0 },
    optOutChecked: true,
    verdict,
    models: {} as ResearchResult['models'],
    prices: { models: {}, cacheWriteFactor: 1.25, tavilyUsdPerCredit: 0.008 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // A backend from before research passes, unless a test says otherwise
  mockPasses.usage.mockRejectedValue(new ApiError(404, 'Not found'))
  mockPasses.story.mockRejectedValue(new ApiError(404, 'Not found'))
  mockResearch.usage.mockResolvedValue(usage())
  mockResearch.runs.mockResolvedValue([])
  mockResearch.start.mockResolvedValue({ taskId: 'task-1', runId: 'run-1' })
  mockStories.taskStatus.mockResolvedValue({
    id: 'task-1',
    type: 'research',
    status: 'running',
    total: 1,
    completed: 0,
    failed: 0,
    errors: [],
    storyIds: ['story-1'],
    createdAt: '',
  })
})

describe('StoryResearch', () => {
  it("shows the month's spend against the cap, and that a run changes nothing until its version is used", async () => {
    renderSection()
    const note = await screen.findByText(/This month: \$1\.50 of \$30\.00 spent/)
    expect(note).toHaveTextContent(/a run you start changes nothing on the story until you use its version/)
    // An older backend sends no fallback counts
    expect(note).not.toHaveTextContent(/Fallbacks/)
  })

  it("counts the month's fallbacks to today's format by category, and the unrecorded ones only when there are any", async () => {
    const counts = { no_other_coverage: 3, not_confirmed: 1, draft_failed_check: 0, technical: 2, unrecorded: 0 }
    mockResearch.usage.mockResolvedValue(usage({ fallbacksThisMonth: counts }))
    renderSection()
    expect(
      await screen.findByText("Fallbacks to today's format this month: 3 no other coverage, 1 not confirmed, 0 draft failed the check, 2 technical."),
    ).toBeInTheDocument()

    mockResearch.usage.mockResolvedValue(usage({ fallbacksThisMonth: { ...counts, unrecorded: 4 } }))
    renderSection()
    expect(await screen.findByText(/2 technical, 4 unrecorded\.$/)).toBeInTheDocument()
  })

  it("names a fallback's category in the run list", async () => {
    const result = researchResult({ kind: 'fallback', reason: 'no usable source', category: 'no_other_coverage' })
    mockResearch.runs.mockResolvedValue([
      {
        id: 'run-1',
        storyId: 'story-1',
        status: 'completed',
        trigger: 'pipeline',
        verdict: 'fallback',
        costUsd: 0.04,
        tavilyCredits: 2,
        error: null,
        startedAt: '2026-11-12T10:00:00Z',
        finishedAt: '2026-11-12T10:01:00Z',
        result,
        cost: null,
      },
    ])
    renderSection()
    const select = await screen.findByRole('combobox', { name: 'Run' })
    expect(within(select).getByRole('option').textContent).toMatch(/ · pipeline · Today's format \(no other coverage\) · \$0\.040$/)
  })

  it('names who started each run in the run list', async () => {
    const base = { storyId: 'story-1', status: 'failed', verdict: null, tavilyCredits: 0, finishedAt: null, result: null, cost: null } as const
    mockResearch.runs.mockResolvedValue([
      { ...base, id: 'run-2', trigger: 'pipeline', costUsd: 0, error: 'skipped: monthly cap reached', startedAt: '2026-11-12T11:00:00Z' },
      { ...base, id: 'run-1', trigger: 'editor', costUsd: 0.25, error: 'unexpected error (Error)', startedAt: '2026-11-12T10:00:00Z' },
    ])
    renderSection()
    const select = await screen.findByRole('combobox', { name: 'Run' })
    expect(
      within(select)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual([expect.stringMatching(/ · pipeline · failed · \$0\.000$/), expect.stringMatching(/ · editor · failed · \$0\.250$/)])
  })

  // Starting a run is the page's action bar's (StoryActionBar.test.tsx)

  describe('using a run’s version and reverting', () => {
    const completed = (over: Partial<ResearchRun> = {}, verdict: ResearchVerdict = { kind: 'keep' }, withDraft = true): ResearchRun => ({
      id: 'run-1',
      storyId: 'story-1',
      status: 'completed',
      trigger: 'editor',
      verdict: verdict.kind,
      costUsd: 0.04,
      tavilyCredits: 2,
      error: null,
      startedAt: '2026-11-12T10:00:00Z',
      finishedAt: '2026-11-12T10:01:00Z',
      result: { ...researchResult(verdict), draft: withDraft ? researchResult(verdict).draft : null },
      cost: null,
      ...over,
    })
    const useButton = () => screen.queryByRole('button', { name: 'Use this version' })
    const revertButton = () => screen.queryByRole('button', { name: 'Revert to single-source' })

    it.each([
      ['a kept run', true, completed()],
      ['a run research rejected, which an editor may overrule', true, completed({}, { kind: 'stale', firstHappened: '2026-01-01' })],
      ['a run that rated the story below the bar', true, completed({}, { kind: 'research-rating', rating: 3 })],
      ["a run that fell back to today's format", false, completed({}, { kind: 'fallback', reason: 'budget', category: 'technical' })],
      ['a completed run without a draft', false, completed({}, { kind: 'keep' }, false)],
      ['a failed run', false, completed({ status: 'failed', result: null })],
    ])('for %s, offers "Use this version": %s', async (_name, offered, run) => {
      mockResearch.runs.mockResolvedValue([run])
      renderSection()
      await screen.findByRole('combobox', { name: 'Run' })
      expect(useButton() !== null).toBe(offered)
    })

    it('applies the chosen run once the editor confirms', async () => {
      mockResearch.runs.mockResolvedValue([completed()])
      renderSection('published')
      fireEvent.click(await screen.findByRole('button', { name: 'Use this version' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent(/blurb, analysis and emotion tag become this run's researched version/)
      expect(dialog).toHaveTextContent(/The story keeps its own rating\./)
      expect(mockResearch.apply).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Use this version' }))
      await waitFor(() => expect(mockResearch.apply).toHaveBeenCalledWith('story-1', 'run-1'))
    })

    it('names no emotion tag in the confirmation for a run stored before research tagged its text', async () => {
      const run = completed()
      const { emotionTag: _none, ...untagged } = run.result!.draft!
      mockResearch.runs.mockResolvedValue([{ ...run, result: { ...run.result!, draft: untagged } }])
      renderSection('published')
      fireEvent.click(await screen.findByRole('button', { name: 'Use this version' }))
      expect(await screen.findByRole('dialog')).toHaveTextContent(/quote, blurb and analysis become this run's researched version/)
    })

    it('keeps "Use this version" visible but disabled, with its reason, on a trashed story', async () => {
      mockResearch.runs.mockResolvedValue([completed()])
      renderSection('trashed')
      const b = await screen.findByRole('button', { name: 'Use this version' })
      expect(b).toHaveAttribute('aria-disabled', 'true')
      expect(b).toHaveAccessibleDescription(/restore it first/)
    })

    it('keeps "Use this version" disabled with the reason while research is switched off, and "Revert to single-source" working', async () => {
      mockResearch.usage.mockResolvedValue(
        usage({ enabled: false, refusal: 'Research is switched off', applyRefusal: 'Research is switched off: TAVILY_API_KEY is not set' }),
      )
      mockResearch.runs.mockResolvedValue([completed()])
      renderSection('published', { title: 'Single-source headline' })
      const use = await screen.findByRole('button', { name: 'Use this version' })
      expect(use).toHaveAttribute('aria-disabled', 'true')
      expect(use).toHaveAccessibleDescription(/TAVILY_API_KEY/)
      expect(revertButton()).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('offers "Revert to single-source" only on a researched story', async () => {
      renderSection('published')
      await screen.findByText('No research runs yet.')
      expect(revertButton()).toBeNull()
    })

    it('reverts a researched story once the editor confirms', async () => {
      renderSection('published', { title: 'Single-source headline', emotionTag: 'frustrating' })
      fireEvent.click(await screen.findByRole('button', { name: 'Revert to single-source' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent(/gets back the headline, summary, analysis and emotion tag it had before research/)
      fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
      await waitFor(() => expect(mockResearch.revert).toHaveBeenCalledWith('story-1'))
    })

    it('names no emotion tag in the revert confirmation when the snapshot keeps none (applied before research tagged its text)', async () => {
      renderSection('published', { title: 'Single-source headline' })
      fireEvent.click(await screen.findByRole('button', { name: 'Revert to single-source' }))
      expect(await screen.findByRole('dialog')).toHaveTextContent(/gets back the headline, summary and analysis it had before research/)
    })
  })

  it('hides itself against a backend without research', async () => {
    mockResearch.usage.mockRejectedValue(new ApiError(404, 'Not found'))
    const client = renderSection()
    await waitFor(() => expect(client.getQueryState(['research-usage'])?.status).toBe('success'))
    expect(screen.queryByRole('heading', { name: 'Research' })).toBeNull()
    expect(mockResearch.runs).not.toHaveBeenCalled()
  })

  it('says when the month’s usage could not be loaded', async () => {
    mockResearch.usage.mockRejectedValue(new ApiError(500, 'Internal error'))
    renderSection()
    expect(await screen.findByText("This month's research usage could not be loaded.")).toBeInTheDocument()
  })
})

describe('StoryResearch with research passes', () => {
  const passUsage = (over: Partial<PassUsage> = {}): PassUsage => ({
    spentUsd: 2,
    capUsd: 30,
    firstPassUsd: 0.4,
    laterPassUsd: 0.25,
    refusal: null,
    on: true,
    ...over,
  })
  const projection = { paragraphs: [], whyThisMatters: [], caveats: [], quoteSourceId: null, sources: [] }
  const version = (over: Partial<ArticleVersionView>): ArticleVersionView => ({
    id: 'v1',
    number: 1,
    kind: 'first',
    status: 'superseded',
    passId: 'pass-1',
    title: 'Researched headline',
    createdAt: '2026-11-14T02:00:00Z',
    research: projection,
    changes: [],
    note: null,
    ...over,
  })
  const pass = (over: Partial<ResearchPass>): ResearchPass => ({
    id: 'pass-1',
    number: 1,
    trigger: 'pipeline',
    kind: 'first',
    status: 'completed',
    outcome: 'written',
    verdict: 'keep',
    costUsd: 0.18,
    modelUsd: 0.12,
    tavilyCredits: 7,
    error: null,
    startedAt: '2026-11-14T02:00:00Z',
    finishedAt: '2026-11-14T02:03:00Z',
    versionId: 'v1',
    record: null,
    ...over,
  })
  const later = pass({
    id: 'pass-2',
    number: 2,
    trigger: 'editor',
    kind: 'later',
    outcome: 'updated',
    verdict: null,
    costUsd: 0.09,
    versionId: 'v2',
    startedAt: '2026-11-16T09:00:00Z',
    record: {
      skippedQueries: ['kenya floods'],
      cards: 'kept',
      cardsError: null,
      update: {
        calls: [],
        judgments: [
          { label: 'Story paragraph 1', verdict: 'wrong', factIds: ['S3F1'], reason: 'The toll was revised', outcome: 'rewrite', founding: ['S3F1'] },
          { label: 'Caveat 1', verdict: 'unchanged', factIds: [], reason: '', outcome: 'unchanged', founding: [] },
        ],
        demoted: [{ ref: 'S1F1', contradictedBy: ['S3F1'], reason: 'The ministry revised the count' }],
        superseded: [],
        checks: [],
        problems: [],
        failedOn: null,
        note: { text: 'n', fallback: false, problems: [], checked: 1, copied: 0 },
        error: null,
      },
    },
  })
  const passes = (over: Partial<StoryPasses> = {}): StoryPasses => ({
    passes: [later, pass({})],
    versions: [
      version({
        id: 'v2',
        number: 2,
        kind: 'update',
        status: 'current',
        passId: 'pass-2',
        createdAt: '2026-11-16T09:03:00Z',
        changes: [
          {
            section: 'Story paragraph 1',
            from: 'Story paragraph 1',
            before: { text: 'The toll stood at 180.', citations: [] },
            after: { text: 'The toll rose to 212.', citations: [] },
          },
        ],
        note: { text: 'The death toll was revised to 212 from 180.', citations: [] },
      }),
      version({}),
    ],
    pool: {
      sources: [
        {
          id: 'src-1',
          ref: 'S1',
          origin: 'search',
          url: 'https://one.example/a',
          outlet: 'One',
          title: 'T',
          date: null,
          kind: 'news-report',
          firstPassId: 'pass-1',
        },
      ],
      facts: [
        {
          id: 'f-1',
          ref: 'S1F1',
          sourceRef: 'S1',
          supportingSentence: 'The toll stood at 180.',
          statement: '180 people died.',
          slot: null,
          verdict: 'supported',
          verdictProblem: null,
          checkedBy: { model: 'm', promptVersion: 'p', passId: 'pass-1' },
          status: 'demoted',
          firstPassId: 'pass-1',
          drop: { passId: 'pass-2', reason: 'contradicted', contradictedBy: ['S3F1'] },
        },
      ],
      searches: [{ kind: 'coverage', slot: null, angle: null, query: 'kenya floods toll', credits: 2, results: 5, cached: false, passId: 'pass-2' }],
      dropped: [],
    },
    legacyRuns: [
      {
        id: 'run-1',
        storyId: 'story-1',
        status: 'completed',
        trigger: 'editor',
        verdict: 'keep',
        costUsd: 0.04,
        tavilyCredits: 2,
        error: null,
        startedAt: '2026-11-12T10:00:00Z',
        finishedAt: '2026-11-12T10:01:00Z',
        result: researchResult({ kind: 'keep' }),
        cost: null,
      },
    ],
    ...over,
  })

  beforeEach(() => {
    mockPasses.usage.mockResolvedValue(passUsage())
    mockPasses.story.mockResolvedValue(passes())
    mockPasses.undo.mockResolvedValue(undefined)
  })

  it('says a pass applies itself, with what each kind reserves, and lists the passes newest first, then the legacy runs', async () => {
    renderSection('published', { title: 'Single-source headline' })
    expect(await screen.findByText(/A research pass applies its own result/)).toHaveTextContent(
      /This month: \$2\.00 of \$30\.00 spent; a first pass reserves \$0\.40 and a later one \$0\.25 until it ends\./,
    )
    const select = await screen.findByRole('combobox', { name: 'Pass or run' })
    expect(
      within(select)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual([
      expect.stringMatching(/^Pass 2 · .* · editor · updated · \$0\.090$/),
      expect.stringMatching(/^Pass 1 · .* · pipeline · written · \$0\.180$/),
      expect.stringMatching(/^Research run · .* · editor · Keep · \$0\.040$/),
    ])
  })

  it('shows the newest pass: each section’s judgment, its text before and after, the Update note, and the fact it demoted with why', async () => {
    renderSection('published', { title: 'Single-source headline' })
    expect(await screen.findByText(/Updated: the sections below were rewritten/)).toBeInTheDocument()
    expect(screen.getByText(/wrong now, rewritten/)).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Before The toll stood at 180.')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'After The toll rose to 212.')).toBeInTheDocument()
    expect(screen.getByText('The death toll was revised to 212 from 180.')).toBeInTheDocument()
    expect(screen.getByText(/contradicted by S3F1: The ministry revised the count/)).toBeInTheDocument()
    expect(screen.getByText('kenya floods')).toBeInTheDocument()
  })

  it('shows a legacy run read-only while the step is on: no "Use this version"', async () => {
    renderSection('published', { title: 'Single-source headline' })
    const select = await screen.findByRole('combobox', { name: 'Pass or run' })
    fireEvent.change(select, { target: { value: 'run:run-1' } })
    expect(await screen.findByText('Researched headline', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this version' })).toBeNull()
  })

  it('undoes the current update once the editor confirms', async () => {
    renderSection('published', { title: 'Single-source headline' })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo this update' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/back to version 1/)
    expect(mockPasses.undo).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo this update' }))
    await waitFor(() => expect(mockPasses.undo).toHaveBeenCalledWith('story-1'))
  })

  it('offers no undo while the current version is the first pass’s', async () => {
    mockPasses.story.mockResolvedValue(passes({ passes: [pass({})], versions: [version({ status: 'current' })] }))
    renderSection('published', { title: 'Single-source headline' })
    await screen.findByRole('combobox', { name: 'Pass or run' })
    expect(screen.queryByRole('button', { name: 'Undo this update' })).toBeNull()
  })

  it('stays as research’s tab while the step is off and the story has no pass', async () => {
    mockPasses.usage.mockResolvedValue(passUsage({ on: false, refusal: 'Research passes are switched off' }))
    mockPasses.story.mockResolvedValue(passes({ passes: [], versions: [] }))
    renderSection()
    expect(await screen.findByText(/a run you start changes nothing on the story until you use its version/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Pass or run' })).toBeNull()
    expect(screen.queryByText(/research pass/i)).toBeNull()
  })
})

describe('singleSourceEmotion', () => {
  it.each<[string, Pick<Story, 'emotionTag' | 'preResearch'>, EmotionTag | null]>([
    ['its own on a single-source story', { emotionTag: 'calm', preResearch: null }, 'calm'],
    [
      'the one its snapshot keeps on a researched story',
      { emotionTag: 'uplifting', preResearch: { title: 'Headline', emotionTag: 'frustrating' } },
      'frustrating',
    ],
    ['none when the snapshot keeps none', { emotionTag: 'uplifting', preResearch: { title: 'Headline', emotionTag: null } }, null],
    ['its own on a story researched before research tagged its text, which kept it', { emotionTag: 'scary', preResearch: { title: 'Headline' } }, 'scary'],
  ])("is the story's tag: %s", (_name, story, tag) => {
    expect(singleSourceEmotion(story)).toBe(tag)
  })
})
