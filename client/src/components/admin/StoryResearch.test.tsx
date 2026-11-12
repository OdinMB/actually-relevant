import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ResearchUsage } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'

const mockResearch = vi.hoisted(() => ({ usage: vi.fn(), runs: vi.fn(), start: vi.fn() }))
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

function renderSection(status = 'analyzed') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BackgroundTaskProvider>
          <StoryResearch story={{ id: 'story-1', status: status as 'analyzed' }} />
        </BackgroundTaskProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return client
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
  it("shows the month's spend against the cap, and says nothing is published", async () => {
    renderSection()
    expect(await screen.findByText(/Admin only, nothing is published\. This month: \$1\.50 of \$30\.00 spent/)).toBeInTheDocument()
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

  it('hides itself against a backend without research', async () => {
    mockResearch.usage.mockRejectedValue(new ApiError(404, 'Not found'))
    const client = renderSection()
    await waitFor(() => expect(client.getQueryState(['research-usage'])?.status).toBe('success'))
    expect(screen.queryByRole('heading', { name: 'Research' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Research this story' })).toBeNull()
    expect(mockResearch.runs).not.toHaveBeenCalled()
  })
})
