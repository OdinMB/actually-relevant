import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ContextAdminBox, ContextAdminRun, ContextRunRecord, StoryContextAdmin as ContextView, TaskState } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'
import { slotKicker } from '../context/contextText'

const mockContext = vi.hoisted(() => ({ get: vi.fn(), gather: vi.fn(), setHidden: vi.fn(), updateBox: vi.fn() }))
const mockStories = vi.hoisted(() => ({ taskStatus: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { storyContext: mockContext, stories: mockStories },
}))

import { ApiError } from '../../lib/admin-api'
import { gatherOutcome } from '../../hooks/useStoryContextAdmin'
import { StoryContextAdmin } from './StoryContextAdmin'
import { slotOutcomes } from './ContextRunView'
import { REMOVED_FIGURE_REASONS } from './removedFigures'

const box = (id: string, over: Partial<ContextAdminBox> = {}): ContextAdminBox => ({
  id,
  type: 'compared',
  heading: `Heading ${id}`,
  teaser: `Teaser ${id}`,
  status: 'unreviewed',
  hidden: false,
  place: 'P1',
  storedPlace: 'P1',
  placeByEditor: false,
  sources: [{ outlet: 'Budget Office', url: 'https://budget.example.org/a' }],
  asOf: '2026-11',
  position: 0,
  ...over,
})

const record: ContextRunRecord = {
  slots: [
    { slot: 'compared', needed: true, covered: 'partly' },
    { slot: 'response', needed: true, covered: 'no' },
    { slot: 'key_term', needed: false, covered: 'no' },
    { slot: 'who_affected', needed: true, covered: 'no' },
  ],
  responseInStory: null,
  responseFallback: false,
  searches: [
    { slot: 'response', wanted: 'what is being done', query: 'varrowen lunches response', recent: true, cached: true, credits: 0, results: 5, kept: [] },
    {
      slot: 'compared',
      wanted: 'earlier years',
      query: 'varrowen pilot pupils',
      recent: false,
      cached: false,
      credits: 1,
      results: 4,
      kept: ['https://budget.example.org/a'],
    },
  ],
  sourceDrops: [{ url: 'https://known.example.org', search: 1, reason: 'known' }],
  extractionDrops: [],
  facts: { research: 6, leftOut: 0, search: 3, reused: 0, supported: 7, rejected: 1, unjudged: 1 },
  droppedFacts: [
    { ref: 'S3F1', text: 'Fires burned 4.4 million hectares this year', verdict: 'rejected', problem: 'The source gives 4.4 million for 2015, not 2026.' },
    { ref: 'S3F2', text: 'The agency starts in January', verdict: 'unjudged', problem: null },
  ],
  boxDrops: [{ label: 'Who it reaches, sentence 1', cause: 'copying', problem: 'Twelve words as the source has them.' }],
  numberHints: [],
  responseNotFound: true,
  tally: { checked: 23, failed: 3 },
  calls: [
    { step: 'structure', outcome: 'ok', costUsd: 0.004, model: 'test-model' },
    { step: 'write', outcome: 'ok', costUsd: 0.011, model: 'test-model' },
  ],
  optOutChecked: true,
}

const run = (over: Partial<ContextAdminRun> = {}): ContextAdminRun => ({
  id: 'run-1',
  status: 'completed',
  outcome: 'built',
  startedAt: '2026-11-16T00:41:00.000Z',
  finishedAt: '2026-11-16T00:42:00.000Z',
  costUsd: 0.031,
  modelUsd: 0.015,
  searchUsd: 0.016,
  tavilyCredits: 2,
  boxes: 5,
  error: null,
  result: record,
  ...over,
})

const BOXES = [
  box('a'),
  box('w', { type: 'next', place: 'W2', storedPlace: 'W2', position: 1 }),
  box('k', { type: 'why_now', place: 'section', storedPlace: null, position: 2 }),
  box('h', { type: 'build_up', hidden: true, status: 'demoted', place: 'section', storedPlace: null, position: 3 }),
]

const view = (over: Partial<ContextView> = {}): ContextView => ({
  run: run(),
  boxes: BOXES,
  places: [
    { place: 'P1', label: 'Paragraph 1', text: 'Lawmakers voted to fund free lunches' },
    { place: 'P2', label: 'Paragraph 2', text: 'It follows an earlier development' },
    { place: 'W1', label: 'Why This Matters 1', text: 'Free meals raise attendance' },
    { place: 'W2', label: 'Why This Matters 2', text: 'Other regions could copy it' },
    { place: 'section', label: 'More context', text: '' },
  ],
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

function renderSection(status = 'published') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BackgroundTaskProvider>
          <StoryContextAdmin story={{ id: 'story-1', slug: 'the-story', status: status as 'published' }} />
        </BackgroundTaskProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

/** Waits until the section's query has its answer. */
const settled = (client: QueryClient) => waitFor(() => expect(client.getQueryState(['story-context-admin', 'story-1'])?.status).toBe('success'))

const section = () => screen.findByRole('region', { name: 'Context' })

beforeEach(() => {
  vi.clearAllMocks()
  mockContext.get.mockResolvedValue(view())
  mockContext.setHidden.mockResolvedValue(undefined)
  mockContext.updateBox.mockResolvedValue(undefined)
  mockContext.gather.mockResolvedValue({ taskId: 'task-1', runId: 'run-2' })
  mockStories.taskStatus.mockResolvedValue(task())
})

describe('StoryContextAdmin', () => {
  it('stays hidden while the story has no context run and cannot have one gathered, and against a backend without context', async () => {
    mockContext.get.mockResolvedValue(
      view({ run: null, boxes: [], gather: { eligible: false, refusal: 'Only published stories get context; this one is selected' } }),
    )
    const first = renderSection()
    await settled(first.client)
    expect(screen.queryByRole('region', { name: 'Context' })).toBeNull()
    first.unmount()

    // A backend from before "Gather context" sends no gather
    mockContext.get.mockResolvedValue(view({ run: null, boxes: [], gather: undefined }))
    const older = renderSection()
    await settled(older.client)
    expect(screen.queryByRole('region', { name: 'Context' })).toBeNull()
    older.unmount()

    mockContext.get.mockRejectedValue(new ApiError(404, 'Not found'))
    const second = renderSection()
    await settled(second.client)
    expect(screen.queryByRole('region', { name: 'Context' })).toBeNull()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
  })

  it('names the research pass that wrote the cards, and shows them for a story with no context run', async () => {
    mockContext.get.mockResolvedValue(
      view({ run: null, gather: { eligible: false, refusal: 'x' }, pass: { id: 'pass-2', number: 2, writtenAt: '2026-11-16T09:03:00Z' } }),
    )
    renderSection()
    const region = await section()
    expect(region).toHaveTextContent(/Research pass 2 wrote these cards on .+\./)
    expect(within(region).getByText('Heading a')).toBeInTheDocument()
    expect(within(region).queryByText('What the run did')).toBeNull()

    // A legacy run's summary would describe cards no longer shown
    mockContext.get.mockResolvedValue(view({ pass: { id: 'pass-2', number: 2, writtenAt: '2026-11-16T09:03:00Z' } }))
    renderSection()
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Context' })).toHaveLength(2))
    expect(screen.queryByText('What the run did')).toBeNull()
  })

  it('says so when the context cannot be loaded', async () => {
    mockContext.get.mockRejectedValue(new ApiError(500, 'Failed to fetch the story context'))
    renderSection()
    expect(await screen.findByText("The story's context could not be loaded.")).toBeInTheDocument()
  })

  it('says what the step built and where each card sits, grouped by place', async () => {
    renderSection()
    const region = await section()
    expect(region).toHaveTextContent(/The newest context run built these cards on .+\./)
    expect(region).toHaveTextContent('3 cards show on the site: 1 beside the text, 1 beside Why This Matters, 1 under More context. 1 hidden.')

    const groups = within(region)
      .getAllByRole('heading', { level: 3 })
      .map(h => h.textContent)
    expect(groups.slice(0, 3)).toEqual(['Beside the text', 'Beside Why This Matters', 'More context'])
    expect(within(region).getByText('Heading a').closest('li')).toHaveTextContent('Phone line: Teaser a · Budget Office · as of November 2026')
    expect(within(region).getByText('Heading h').closest('li')).toHaveTextContent('Readers no longer see it; nothing was deleted.')
    expect(within(region).getByRole('link', { name: /See it on the story page/ })).toHaveAttribute('href', '/stories/the-story')
  })

  it('hides one card and moves another, each with a toast', async () => {
    const user = userEvent.setup()
    renderSection()
    await section()

    await user.click(screen.getByRole('button', { name: 'Hide Heading a' }))
    await waitFor(() => expect(mockContext.updateBox).toHaveBeenCalledWith('story-1', 'a', { hidden: true }))
    expect(await screen.findByText('Hid "Heading a": readers no longer see it.')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Where Heading w sits' }), 'W1')
    await waitFor(() => expect(mockContext.updateBox).toHaveBeenCalledWith('story-1', 'w', { place: 'W1' }))
    expect(await screen.findByText('Moved "Heading w" beside Why This Matters 1.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show Heading h' }))
    await waitFor(() => expect(mockContext.updateBox).toHaveBeenCalledWith('story-1', 'h', { hidden: false }))
  })

  it('keeps a hidden card where it is, and lets every shown card move', async () => {
    renderSection()
    await section()
    expect(screen.getByRole('combobox', { name: 'Where Heading h sits' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Where Heading k sits' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Where Heading a sits' })).toBeEnabled()
  })

  it('shows an error toast when a change fails', async () => {
    const user = userEvent.setup()
    mockContext.updateBox.mockRejectedValue(new ApiError(400, 'The story has no P9'))
    renderSection()
    await section()
    await user.click(screen.getByRole('button', { name: 'Hide Heading a' }))
    expect(await screen.findByText('Couldn\'t change "Heading a": The story has no P9')).toBeInTheDocument()
  })

  it('asks before hiding all context', async () => {
    const user = userEvent.setup()
    renderSection()
    await section()

    await user.click(screen.getByRole('button', { name: 'Hide all context' }))
    let dialog = await screen.findByRole('dialog', { name: 'Hide all context?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(mockContext.setHidden).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Hide all context' }))
    dialog = await screen.findByRole('dialog', { name: 'Hide all context?' })
    await user.click(within(dialog).getByRole('button', { name: 'Hide all context' }))
    await waitFor(() => expect(mockContext.setHidden).toHaveBeenCalledWith('story-1', true))
    expect(await screen.findByText('Hid all context: readers no longer see any card of this story.')).toBeInTheDocument()
  })

  it('shows all context again without asking once every card is hidden', async () => {
    const user = userEvent.setup()
    mockContext.get.mockResolvedValue(view({ boxes: BOXES.map(b => ({ ...b, hidden: true, status: 'demoted' })) }))
    renderSection('analyzed')
    const region = await section()
    expect(region).toHaveTextContent('No card shows on the site. 4 hidden.')
    expect(within(region).queryByRole('link', { name: /See it on the story page/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show all context' }))
    await waitFor(() => expect(mockContext.setHidden).toHaveBeenCalledWith('story-1', false))
  })

  it('says when an unpublished story keeps its cards from readers', async () => {
    renderSection('analyzed')
    expect(await section()).toHaveTextContent('The story is not published now, so readers see none of them.')
  })

  it('marks a pass’s cards hidden from readers while the card gate holds them back, and claims none shows on the site', async () => {
    const why = "Research passes' cards stay off the story page: their evals are pending"
    mockContext.get.mockResolvedValue(view({ pass: { id: 'pass-2', number: 2, writtenAt: '2026-11-16T09:03:00Z' }, hiddenFromReaders: why }))
    renderSection()
    const region = await section()
    expect(within(region).getByText('Hidden from readers', { selector: 'span' })).toBeInTheDocument()
    expect(region).toHaveTextContent(why)
    expect(region).not.toHaveTextContent(/shows? on the site/)
    // Still listed, for the editor to hide or move before readers see them
    expect(within(region).getByText('Heading a')).toBeInTheDocument()
  })

  it('shows what the run did: each slot, the searches, the dropped facts with their reasons and the cost', async () => {
    const user = userEvent.setup()
    renderSection()
    const region = await section()
    await user.click(within(region).getByText('What the run did'))

    const details = within(region).getByText('What the run did').closest('details')!
    const row = (text: string) => within(details).getByText(text).closest('li')!
    expect(row(slotKicker('compared'))).toHaveTextContent('found with a search of its own')
    expect(row(slotKicker('key_term'))).toHaveTextContent('not needed')
    expect(row(slotKicker('who_affected'))).toHaveTextContent('nothing the sources support, so no card')
    expect(row('searched, nothing sourced, so no card')).toHaveTextContent(slotKicker('response'))

    expect(details).toHaveTextContent('Searches: 2 web searches, 1 of them answered from the cache')
    expect(row('“varrowen lunches response”')).toHaveTextContent('from the cache')
    expect(details).toHaveTextContent('Results left out: 1 already a source.')

    expect(details).toHaveTextContent('Checks: 23 facts and card lines checked, 20 kept, 3 dropped')
    expect(row('“Fires burned 4.4 million hectares this year”')).toHaveTextContent('droppedThe source gives 4.4 million for 2015, not 2026.')
    expect(row('“The agency starts in January”')).toHaveTextContent('not judged')
    expect(row('Who it reaches, sentence 1')).toHaveTextContent('too close to its source’s wordingTwelve words as the source has them.')

    expect(row('AI, 2 calls')).toHaveTextContent('$0.015')
    expect(row('Web search, 2 credits')).toHaveTextContent('$0.016')
    expect(row('This story')).toHaveTextContent('$0.031')
  })

  it('says why a run built nothing', async () => {
    mockContext.get.mockResolvedValue(view({ run: run({ status: 'failed', outcome: 'technical', error: 'Tavily answered 502.', result: null }), boxes: [] }))
    renderSection()
    const region = await section()
    expect(region).toHaveTextContent(/The newest context run failed on .+: Tavily answered 502\. It does not try again on its own\./)
    expect(within(region).queryByRole('button', { name: 'Hide all context' })).toBeNull()
    expect(within(region).getByText('The run recorded no details.')).toBeInTheDocument()
  })

  it("says when the cards shown are an earlier run's, the newest having kept none", async () => {
    mockContext.get.mockResolvedValue(view({ run: run({ outcome: 'none-kept' }) }))
    renderSection()
    expect(await section()).toHaveTextContent(/The newest context run, on .+, kept no card\. The cards below are from an earlier run\./)
  })

  // Gather context itself is the page's action bar's (StoryActionBar.test.tsx)
  it('shows a story without a run that can have context gathered', async () => {
    mockContext.get.mockResolvedValue(view({ run: null, boxes: [] }))
    renderSection()
    const region = await section()
    expect(region).toHaveTextContent('This story has no context cards yet.')
    expect(within(region).queryByText('What the run did')).toBeNull()
    expect(within(region).queryByRole('button', { name: /Gather/ })).toBeNull()
  })

  it('says when a run of the story is building its cards', async () => {
    mockContext.get.mockResolvedValue(view({ run: run({ status: 'running', outcome: null, finishedAt: null }) }))
    renderSection()
    expect(await section()).toHaveTextContent(/A context run has been building this story's cards since/)
  })

  it('shows what the run took over from earlier runs: facts carried over, searches not made again, pages already read', async () => {
    const user = userEvent.setup()
    const reran: ContextRunRecord = {
      ...record,
      skippedSearches: [{ slot: 'who_affected', query: 'varrowen pupils reached' }],
      sourceDrops: [{ url: 'https://read.example.org', search: 1, reason: 'read' }],
      facts: { ...record.facts, carried: 4 },
    }
    mockContext.get.mockResolvedValue(view({ run: run({ result: reran }) }))
    renderSection()
    const region = await section()
    await user.click(within(region).getByText('What the run did'))
    const details = within(region).getByText('What the run did').closest('details')!
    expect(details).toHaveTextContent('Built on earlier runs: 4 facts carried over, not checked again, 1 search not made again, 1 result already read')
    expect(within(details).getByText('“varrowen pupils reached”').closest('li')).toHaveTextContent('made by an earlier run')
    expect(details).toHaveTextContent('Results left out: 1 already read in an earlier run.')
    // The slot an earlier run searched for counts as searched
    expect(within(details).getByText('searched, nothing the sources support').closest('li')).toHaveTextContent(slotKicker('who_affected'))
  })

  it('lists each figure the figure check removed with what it counted and the reason its answer gives', async () => {
    const user = userEvent.setup()
    const checked: ContextRunRecord = {
      ...record,
      removedFigures: [
        { ref: 'S2F3', figure: 'about 2.88 million hectares', counted: 'area burned', answer: 'computed' },
        { ref: 'S1F2', figure: '40 percent', counted: '', answer: 'other-thing' },
      ],
    }
    mockContext.get.mockResolvedValue(view({ run: run({ result: checked }) }))
    renderSection()
    const region = await section()
    await user.click(within(region).getByText('What the run did'))
    const details = within(region).getByText('What the run did').closest('details')!
    const row = (ref: string) => within(details).getByText(ref).closest('li')!

    expect(details).toHaveTextContent('2 figures removed: not found in the source')
    expect(row('S2F3')).toHaveTextContent('“about 2.88 million hectares” (area burned)')
    expect(row('S2F3')).toHaveTextContent(REMOVED_FIGURE_REASONS.computed)
    expect(row('S2F3')).not.toHaveTextContent(REMOVED_FIGURE_REASONS['other-thing'])
    // Nothing was said to be counted, so the line names none
    expect(row('S1F2').textContent).toBe(`S1F2 “40 percent”${REMOVED_FIGURE_REASONS['other-thing']}`)
  })

  it('shows no removed figures for a record from before the figure check, nor for one that removed none', async () => {
    const user = userEvent.setup()
    for (const result of [record, { ...record, removedFigures: [] }]) {
      mockContext.get.mockResolvedValue(view({ run: run({ result }) }))
      const { unmount } = renderSection()
      const region = await section()
      await user.click(within(region).getByText('What the run did'))
      expect(within(region).getByText('What the run did').closest('details')).not.toHaveTextContent(/removed: not found in the source/)
      unmount()
    }
  })
})

describe('gatherOutcome', () => {
  it("words a finished run, and keeps a failed one's reason until dismissed", () => {
    expect(gatherOutcome(task({ status: 'completed', completed: 1 }))).toEqual({
      message: 'Context gathered: the Context section shows what the run kept.',
      sticky: false,
    })
    expect(
      gatherOutcome(task({ status: 'failed', failed: 1, errors: ['The run failed on a technical problem; the Context section shows the error'] })),
    ).toEqual({
      message: 'Gathering context: The run failed on a technical problem; the Context section shows the error',
      sticky: true,
    })
    expect(gatherOutcome(task({ status: 'failed', failed: 1 })).message).toBe('Gathering context: the run failed')
  })
})

describe('slotOutcomes', () => {
  it('names a response the story reports, and a needed slot searched for in vain', () => {
    const outcomes = slotOutcomes(
      {
        slots: [
          { slot: 'response', needed: true, covered: 'yes' },
          { slot: 'why_now', needed: true, covered: 'no' },
        ],
        responseInStory: 'The ministry will fund it.',
        searches: [{ slot: 'why_now', wanted: '', query: 'q', recent: false, cached: false, credits: 1, results: 0, kept: [] }],
      },
      [],
    )
    expect(outcomes).toEqual([
      { outcome: 'the story itself reports it', slots: [slotKicker('response')] },
      { outcome: 'searched, nothing the sources support', slots: [slotKicker('why_now')] },
    ])
  })
})
