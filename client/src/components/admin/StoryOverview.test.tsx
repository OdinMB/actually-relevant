import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { Story, StoryOverviewBlock } from '@shared/types'
import { ApiError } from '../../lib/admin-api'
import { renderAdminRoutes } from '../../test/admin'
import { StoryOverview } from './StoryOverview'

const mockApi = vi.hoisted(() => ({ overviews: { story: vi.fn(), attach: vi.fn(), detach: vi.fn() } }))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

const STORY = { id: 's1' } as Story
const EBOLA = { id: 'o1', title: 'Ebola in Ituri', scope: 'ongoing', status: 'open' } as const
const CHOLERA = { id: 'o2', title: 'Cholera in Kasai', scope: 'forming', status: 'quiet' } as const

function block(over: Partial<StoryOverviewBlock> = {}): StoryOverviewBlock {
  return {
    on: true,
    count: 2,
    published: true,
    membership: null,
    left: [],
    lastLink: {
      id: 'd1',
      outcome: 'none',
      overviewId: null,
      createdAt: '2026-11-02T03:00:00.000Z',
      undoneAt: null,
      candidates: [
        { kind: 'overview', ref: 'O1', id: 'o1', title: 'Ebola in Ituri', distance: 0.2, belongs: 'no' },
        { kind: 'story', ref: 'F1', id: 's9', title: 'Story 9', distance: 0.31, belongs: null },
      ],
      refusals: [{ id: 'O1', reason: 'a quote was not found in the story' }],
    },
    attachable: [EBOLA, CHOLERA],
    ...over,
  }
}

const renderBlock = () => renderAdminRoutes([{ path: '/admin/stories/:id', element: <StoryOverview story={STORY} /> }], { history: ['/admin/stories/s1'] })

describe('StoryOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.overviews.story.mockResolvedValue(block())
    mockApi.overviews.attach.mockResolvedValue({ decisionId: 'd2' })
    mockApi.overviews.detach.mockResolvedValue({ decisionId: 'd3' })
  })

  it('shows nothing while the step is off and no overview exists, nor against a backend without overviews', async () => {
    mockApi.overviews.story.mockResolvedValue(block({ on: false, count: 0 }))
    const { unmount } = renderBlock()
    await waitFor(() => expect(mockApi.overviews.story).toHaveBeenCalledWith('s1'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()
    unmount()

    mockApi.overviews.story.mockRejectedValue(new ApiError(404, 'Not found'))
    renderBlock()
    await waitFor(() => expect(mockApi.overviews.story).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('heading', { name: 'Overview' })).not.toBeInTheDocument()
  })

  it('says when the last link was shown no candidates, and when it was undone', async () => {
    mockApi.overviews.story.mockResolvedValue(
      block({
        lastLink: {
          id: 'd1',
          outcome: 'joined',
          overviewId: 'o1',
          createdAt: '2026-11-02T03:00:00.000Z',
          undoneAt: '2026-11-03T00:00:00.000Z',
          candidates: [],
          refusals: [],
        },
      }),
    )
    renderBlock()
    expect(await screen.findByText('It was shown no candidates.')).toBeInTheDocument()
    expect(screen.getByText(/^joined, Nov 2.*, undone Nov 3/)).toBeInTheDocument()
  })

  it("shows the last link decision's candidates with what the model said, and the answers code refused", async () => {
    renderBlock()
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ebola in Ituri' })).toHaveAttribute('href', '/admin/overviews/o1')
    expect(screen.getByText(/distance 0\.20, does not belong/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Story 9' })).toHaveAttribute('href', '/admin/stories/s9')
    expect(screen.getByText(/founding partner, distance 0\.31, not judged/)).toBeInTheDocument()
    expect(screen.getByText('O1: a quote was not found in the story')).toBeInTheDocument()
  })

  it('attaches the story to the chosen overview, and shows the server’s refusal', async () => {
    renderBlock()
    const attach = await screen.findByRole('button', { name: 'Attach' })
    expect(attach).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByLabelText('Attach to overview'), { target: { value: 'o2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(mockApi.overviews.attach).toHaveBeenCalledWith('o2', 's1'))
    expect(await screen.findByText('Story attached to "Cholera in Kasai"')).toBeInTheDocument()

    mockApi.overviews.attach.mockRejectedValue(new ApiError(409, 'The story is in "Ebola in Ituri": detach it there first'))
    fireEvent.change(screen.getByLabelText('Attach to overview'), { target: { value: 'o1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(await screen.findByText('The story is in "Ebola in Ituri": detach it there first')).toBeInTheDocument()
  })

  it('says why an unpublished story cannot be attached', async () => {
    mockApi.overviews.story.mockResolvedValue(block({ published: false }))
    renderBlock()
    fireEvent.change(await screen.findByLabelText('Attach to overview'), { target: { value: 'o2' } })
    const attach = screen.getByRole('button', { name: 'Attach' })
    expect(attach).toHaveAttribute('aria-disabled', 'true')
    expect(attach).toHaveAccessibleDescription('Only a published story can join an overview')
    fireEvent.click(attach)
    expect(mockApi.overviews.attach).not.toHaveBeenCalled()
  })

  it('shows the overview it is in, with nothing to attach to, and detaches it after a confirmation', async () => {
    mockApi.overviews.story.mockResolvedValue(
      block({
        membership: {
          entryId: 'e1',
          overview: EBOLA,
          role: 'turning_point',
          roleKind: 'response',
          joinedBy: 'pipeline',
          joinedAt: '2026-11-02T03:00:00.000Z',
          locked: false,
          confidence: 0.82,
        },
        left: [{ entryId: 'e0', overview: CHOLERA, detachReason: 'editor', detachedAt: '2026-11-01T00:00:00.000Z', locked: true }],
        attachable: [],
      }),
    )
    renderBlock()
    expect(await screen.findByText('Turning point: Response')).toBeInTheDocument()
    expect(screen.getByText(/confidence 82%/)).toBeInTheDocument()
    expect(screen.getByText(/Detached by an editor/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Attach to overview')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Detach from overview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockApi.overviews.detach).toHaveBeenCalledWith('o1', 'e1'))
  })
})
