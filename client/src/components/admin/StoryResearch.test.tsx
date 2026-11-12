import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ResearchResult, ResearchRun, ResearchUsage, ResearchVerdict } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'

const mockResearch = vi.hoisted(() => ({ usage: vi.fn(), runs: vi.fn(), start: vi.fn(), apply: vi.fn(), revert: vi.fn() }))
const mockStories = vi.hoisted(() => ({ taskStatus: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { research: mockResearch, stories: mockStories },
}))

import { ApiError } from '../../lib/admin-api'
import { StoryResearch } from './StoryResearch'

const usage = (over: Partial<ResearchUsage> = {}): ResearchUsage => ({
  enabled: true,
  refusal: null,
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
          <StoryResearch story={{ id: 'story-1', status: status as 'analyzed', preResearch }} />
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
      story: [{ sentences: [{ text: 'A sentence.', factIds: [] }] }],
      summary: 'Summary.',
      whyThisMatters: [],
      caveats: [],
      quote: '',
      quoteAttribution: '',
      quoteSourceId: 'S0',
      marketingBlurb: 'Blurb.',
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

const button = () => screen.findByRole('button', { name: 'Research this story' })

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(note).toHaveTextContent(/a run changes nothing on the story until you use its version/)
  })

  it.each([
    ['research is switched off', usage({ enabled: false, refusal: 'Research is switched off: TAVILY_API_KEY is not set' }), 'analyzed', /switched off/],
    ['the cap is reached', usage({ refusal: "This month's research cap is reached" }), 'analyzed', /cap is reached/],
    ['the story is not analyzed, selected or published', usage(), 'fetched', /this one is fetched/],
  ])('keeps the button visible but disabled, with its reason, when %s', async (_name, answer, status, reason) => {
    mockResearch.usage.mockResolvedValue(answer)
    renderSection(status)
    const b = await button()
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).toHaveAccessibleDescription(reason)
    fireEvent.click(b)
    expect(mockResearch.start).not.toHaveBeenCalled()
  })

  it('disables the button while a run of the story is running', async () => {
    mockResearch.runs.mockResolvedValue([
      {
        id: 'run-1',
        storyId: 'story-1',
        status: 'running',
        verdict: null,
        costUsd: 0.25,
        tavilyCredits: 0,
        error: null,
        startedAt: '2026-11-12T10:00:00Z',
        finishedAt: null,
        result: null,
        cost: null,
      },
    ])
    renderSection()
    await waitFor(async () => expect(await button()).toHaveAccessibleDescription(/in progress/))
  })

  it('starts a polled task for this story when pressed', async () => {
    renderSection()
    fireEvent.click(await button())
    await waitFor(() => expect(mockResearch.start).toHaveBeenCalledWith('story-1'))
    expect(await screen.findByText('Researching the story...')).toBeInTheDocument()
  })

  describe('using a run’s version and reverting', () => {
    const completed = (over: Partial<ResearchRun> = {}, verdict: ResearchVerdict = { kind: 'keep' }, withDraft = true): ResearchRun => ({
      id: 'run-1',
      storyId: 'story-1',
      status: 'completed',
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
      ['a run research rejected, which an editor may overrule', true, completed({}, { kind: 'research-rating', rating: 3 })],
      ["a run that fell back to today's format", false, completed({}, { kind: 'fallback', reason: 'budget' })],
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
      expect(mockResearch.apply).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Use this version' }))
      await waitFor(() => expect(mockResearch.apply).toHaveBeenCalledWith('story-1', 'run-1'))
    })

    it('keeps "Use this version" visible but disabled, with its reason, on a trashed story', async () => {
      mockResearch.runs.mockResolvedValue([completed()])
      renderSection('trashed')
      const b = await screen.findByRole('button', { name: 'Use this version' })
      expect(b).toHaveAttribute('aria-disabled', 'true')
      expect(b).toHaveAccessibleDescription(/restore it first/)
    })

    it('keeps "Use this version" disabled while research is switched off, and "Revert to single-source" working', async () => {
      mockResearch.usage.mockResolvedValue(usage({ enabled: false, refusal: 'Research is switched off: TAVILY_API_KEY is not set' }))
      mockResearch.runs.mockResolvedValue([completed()])
      renderSection('published', { title: 'Single-source headline' })
      const use = await screen.findByRole('button', { name: 'Use this version' })
      expect(use).toHaveAttribute('aria-disabled', 'true')
      expect(use).toHaveAccessibleDescription(/switched off/)
      expect(revertButton()).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('offers "Revert to single-source" only on a researched story', async () => {
      renderSection('published')
      await screen.findByRole('button', { name: 'Research this story' })
      expect(revertButton()).toBeNull()
    })

    it('reverts a researched story once the editor confirms', async () => {
      renderSection('published', { title: 'Single-source headline' })
      fireEvent.click(await screen.findByRole('button', { name: 'Revert to single-source' }))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Revert' }))
      await waitFor(() => expect(mockResearch.revert).toHaveBeenCalledWith('story-1'))
    })
  })

  it('hides itself against a backend without research', async () => {
    mockResearch.usage.mockRejectedValue(new ApiError(404, 'Not found'))
    const client = renderSection()
    await waitFor(() => expect(client.getQueryState(['research-usage'])?.status).toBe('success'))
    expect(screen.queryByRole('heading', { name: 'Research' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Research this story' })).toBeNull()
    expect(mockResearch.runs).not.toHaveBeenCalled()
  })
})
