import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ContextAdminRun, ResearchUsage, Story, StoryContextAdmin, StoryStatus, TaskState } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'

const mockStories = vi.hoisted(() => ({ preassess: vi.fn(), assess: vi.fn(), publish: vi.fn(), updateStatus: vi.fn(), taskStatus: vi.fn() }))
const mockResearch = vi.hoisted(() => ({ usage: vi.fn(), runs: vi.fn(), start: vi.fn() }))
const mockContext = vi.hoisted(() => ({ get: vi.fn(), gather: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { stories: mockStories, research: mockResearch, storyContext: mockContext },
}))

import { ApiError } from '../../lib/admin-api'
import { StoryActionBar } from './StoryActionBar'

type BarStory = Pick<Story, 'id' | 'status' | 'relevance' | 'preResearch'>

const usage = (over: Partial<ResearchUsage> = {}): ResearchUsage => ({
  enabled: true,
  refusal: null,
  applyRefusal: null,
  monthToDateUsd: 1.5,
  monthlyCapUsd: 30,
  reservationUsd: 0.25,
  ...over,
})

const contextRun = (over: Partial<ContextAdminRun> = {}): ContextAdminRun => ({
  id: 'run-1',
  status: 'completed',
  outcome: 'built',
  startedAt: '2026-11-16T00:41:00.000Z',
  finishedAt: '2026-11-16T00:42:00.000Z',
  costUsd: 0.031,
  modelUsd: 0.015,
  searchUsd: 0.016,
  tavilyCredits: 2,
  boxes: 0,
  error: null,
  result: null,
  ...over,
})

const contextView = (over: Partial<StoryContextAdmin> = {}): StoryContextAdmin => ({
  run: null,
  boxes: [],
  places: [],
  placement: 'model',
  gather: { eligible: true, refusal: null },
  ...over,
})

const task = (over: Partial<TaskState> = {}): TaskState => ({
  id: 'task-1',
  type: 'context',
  status: 'running',
  total: 1,
  completed: 0,
  failed: 0,
  errors: [],
  storyIds: ['story-1'],
  createdAt: '',
  ...over,
})

function renderBar(status: StoryStatus, { dirty = false, saving = false, relevance = 7 as number | null, researched = false } = {}) {
  const onDiscard = vi.fn()
  const onCancel = vi.fn()
  const story: BarStory = { id: 'story-1', status, relevance, preResearch: researched ? { title: 'Single-source headline' } : null }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BackgroundTaskProvider>
          <StoryActionBar story={story} dirty={dirty} saving={saving} onCancel={onCancel} onDiscard={onDiscard} />
        </BackgroundTaskProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, client, onDiscard, onCancel }
}

const bar = () => screen.getByRole('region', { name: 'Story actions' })
const action = (name: string) => within(bar()).getByRole('button', { name })
const findAction = (name: string) => within(bar()).findByRole('button', { name })
const closed = (button: HTMLElement, reason: RegExp | string) => {
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).toHaveAccessibleDescription(reason)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResearch.usage.mockResolvedValue(usage())
  mockResearch.runs.mockResolvedValue([])
  mockResearch.start.mockResolvedValue({ taskId: 'task-1', runId: 'run-1' })
  mockContext.get.mockResolvedValue(contextView())
  mockContext.gather.mockResolvedValue({ taskId: 'task-1', runId: 'run-2' })
  mockStories.taskStatus.mockResolvedValue(task())
})

describe('StoryActionBar', () => {
  it('publishes an analyzed story as a background task, and closes every action while the task works on it', async () => {
    const user = userEvent.setup()
    mockStories.publish.mockReturnValue(new Promise(() => {}))
    renderBar('analyzed')
    await findAction('Research')
    await user.click(action('Publish'))
    expect(mockStories.publish).toHaveBeenCalledWith('story-1')
    expect(await screen.findByText('Publishing story...')).toBeInTheDocument()
    for (const name of ['Publish', 'Re-assess', 'Research', 'Reject']) closed(action(name), /A task is working on this story/)
    await user.click(action('Reject'))
    expect(mockStories.updateStatus).not.toHaveBeenCalled()
  })

  it('rejects and trashes the story as the list does, with its toast', async () => {
    const user = userEvent.setup()
    mockStories.updateStatus.mockResolvedValue({ id: 'story-1', status: 'rejected' })
    renderBar('published')
    await user.click(action('Reject'))
    await waitFor(() => expect(mockStories.updateStatus).toHaveBeenCalledWith('story-1', 'rejected'))
    expect(await screen.findByText('Status updated')).toBeInTheDocument()
    await user.click(action('Trash'))
    await waitFor(() => expect(mockStories.updateStatus).toHaveBeenCalledWith('story-1', 'trashed'))
  })

  it('asks before an action throws unsaved edits away: Cancel keeps them, confirming discards them and then acts', async () => {
    const user = userEvent.setup()
    mockStories.publish.mockReturnValue(new Promise(() => {}))
    const { onDiscard } = renderBar('selected', { dirty: true })
    await user.click(action('Publish'))
    const dialog = await screen.findByRole('dialog', { name: 'Discard your unsaved changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onDiscard).not.toHaveBeenCalled()
    expect(mockStories.publish).not.toHaveBeenCalled()

    await user.click(action('Publish'))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard and publish' }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(mockStories.publish).toHaveBeenCalledWith('story-1')
  })

  it('starts research at once though edits are unsaved, since a run writes nothing on the story', async () => {
    const user = userEvent.setup()
    const { onDiscard } = renderBar('analyzed', { dirty: true })
    await user.click(await findAction('Research'))
    await waitFor(() => expect(mockResearch.start).toHaveBeenCalledWith('story-1'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onDiscard).not.toHaveBeenCalled()
    expect(await screen.findByText('Researching the story...')).toBeInTheDocument()
  })

  it('asks before a re-assessment, saying it drops the researched version, and assesses on confirm without discarding', async () => {
    const user = userEvent.setup()
    mockStories.assess.mockReturnValue(new Promise(() => {}))
    const { onDiscard } = renderBar('published', { researched: true })
    await user.click(action('Re-assess'))
    const dialog = await screen.findByRole('dialog', { name: 'Re-assess this story?' })
    expect(dialog).toHaveTextContent(/researched version it shows is dropped/)
    await user.click(within(dialog).getByRole('button', { name: 'Re-assess' }))
    expect(mockStories.assess).toHaveBeenCalledWith('story-1')
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('pre-assesses a fetched story and assesses a pre-assessed one, and keeps Publish closed until the story has a rating', async () => {
    const user = userEvent.setup()
    mockStories.preassess.mockReturnValue(new Promise(() => {}))
    mockStories.assess.mockReturnValue(new Promise(() => {}))
    const first = renderBar('fetched', { relevance: null })
    closed(action('Publish'), /needs a rating/)
    await user.click(action('Pre-assess'))
    expect(mockStories.preassess).toHaveBeenCalledWith(['story-1'])
    first.unmount()

    renderBar('pre_analyzed', { relevance: null })
    await user.click(action('Assess'))
    expect(mockStories.assess).toHaveBeenCalledWith('story-1')
  })

  it('closes every action while the form saves, and Save until there is something to save', async () => {
    const user = userEvent.setup()
    const saving = renderBar('analyzed', { dirty: true, saving: true })
    closed(action('Publish'), 'Saving the story')
    await user.click(action('Publish'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockStories.publish).not.toHaveBeenCalled()
    saving.unmount()

    const { onCancel } = renderBar('analyzed')
    expect(action('Save')).toBeDisabled()
    await user.click(action('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('offers the other actions in a menu on a phone, a closed one saying why in words', async () => {
    // jsdom has no ResizeObserver; the menu only uses it to follow its button
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    const user = userEvent.setup()
    mockStories.updateStatus.mockResolvedValue({ id: 'story-1', status: 'trashed' })
    mockResearch.usage.mockResolvedValue(usage({ refusal: "This month's research cap is reached" }))
    renderBar('analyzed')
    await findAction('Research')
    await user.click(action('More'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Research/ })).toHaveTextContent("This month's research cap is reached")
    expect(within(menu).getByRole('menuitem', { name: /Research/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(menu).getByRole('menuitem', { name: 'Trash' }))
    await waitFor(() => expect(mockStories.updateStatus).toHaveBeenCalledWith('story-1', 'trashed'))
  })

  describe('Research', () => {
    it.each([
      ['research is switched off', usage({ enabled: false, refusal: 'Research is switched off: TAVILY_API_KEY is not set' }), /switched off/],
      ['the cap is reached', usage({ refusal: "This month's research cap is reached" }), /cap is reached/],
    ])('stays visible but closed, with its reason, when %s', async (_name, answer, reason) => {
      const user = userEvent.setup()
      mockResearch.usage.mockResolvedValue(answer)
      renderBar('analyzed')
      const button = await findAction('Research')
      closed(button, reason)
      await user.click(button)
      expect(mockResearch.start).not.toHaveBeenCalled()
    })

    it('is closed while a run of the story is running', async () => {
      mockResearch.runs.mockResolvedValue([{ id: 'run-1', storyId: 'story-1', status: 'running' }])
      renderBar('selected')
      await waitFor(async () => closed(await findAction('Research'), /in progress/))
    })

    it('is left out against a backend without research', async () => {
      mockResearch.usage.mockRejectedValue(new ApiError(404, 'Not found'))
      const { client } = renderBar('analyzed')
      await waitFor(() => expect(client.getQueryState(['research-usage'])?.status).toBe('success'))
      expect(within(bar()).queryByRole('button', { name: 'Research' })).toBeNull()
    })
  })

  describe('Gather context', () => {
    it('gathers a published story’s context as a polled task, closed while it runs', async () => {
      const user = userEvent.setup()
      renderBar('published')
      await user.click(await findAction('Gather context'))
      await waitFor(() => expect(mockContext.gather).toHaveBeenCalledWith('story-1'))
      expect(await screen.findByText(/Gathering context\.\.\./)).toBeInTheDocument()
      await waitFor(() => closed(action('Gather context'), 'Context is being gathered for this story now'))
      await user.click(action('Gather context'))
      expect(mockContext.gather).toHaveBeenCalledTimes(1)
    })

    it('says when the run ends, once the story has a run', async () => {
      const user = userEvent.setup()
      mockContext.get.mockResolvedValue(contextView({ run: contextRun() }))
      mockStories.taskStatus.mockResolvedValue(task({ status: 'completed', completed: 1 }))
      renderBar('published')
      await user.click(await findAction('Gather more context'))
      expect(await screen.findByText('Context gathered: the Context section shows what the run kept.', undefined, { timeout: 4000 })).toBeInTheDocument()
    })

    it("says why a run cannot start: the server's refusal on the button, its 409 in a toast", async () => {
      const user = userEvent.setup()
      mockContext.get.mockResolvedValue(
        contextView({ gather: { eligible: true, refusal: 'Web search is off (TAVILY_API_KEY is not set), so context cannot be gathered' } }),
      )
      const first = renderBar('published')
      const button = await findAction('Gather context')
      closed(button, /Web search is off/)
      await user.click(button)
      expect(mockContext.gather).not.toHaveBeenCalled()
      first.unmount()

      mockContext.get.mockResolvedValue(contextView())
      mockContext.gather.mockRejectedValue(new ApiError(409, 'Context is already being gathered for this story'))
      renderBar('published')
      await user.click(await findAction('Gather context'))
      expect(await screen.findByText('Gathering context: Context is already being gathered for this story')).toBeInTheDocument()
    })

    it('is closed while a run of the story is running', async () => {
      mockContext.get.mockResolvedValue(contextView({ run: contextRun({ status: 'running', outcome: null, finishedAt: null }) }))
      renderBar('published')
      closed(await findAction('Gather more context'), 'Context is being gathered for this story now')
    })

    it('is left out while the story has no Context section', async () => {
      mockContext.get.mockResolvedValue(contextView({ gather: { eligible: false, refusal: 'The story has no research facts' } }))
      const { client } = renderBar('published')
      await waitFor(() => expect(client.getQueryState(['story-context-admin', 'story-1'])?.status).toBe('success'))
      expect(within(bar()).queryByRole('button', { name: /Gather/ })).toBeNull()
    })
  })
})
