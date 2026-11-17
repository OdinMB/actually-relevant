import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, useLocation } from 'react-router-dom'
import type { Story } from '@shared/types'
import { renderAdminRoutes } from '../../test/admin'
import { returnState, storyPath } from '../../components/admin/storyReturn'

const mockApi = vi.hoisted(() => ({
  stories: { get: vi.fn(), update: vi.fn(), dissolveCluster: vi.fn() },
  issues: { list: vi.fn() },
  bluesky: { generateDraft: vi.fn() },
  mastodon: { generateDraft: vi.fn() },
  // A backend without research or context: their tabs and actions have their own tests
  research: { usage: vi.fn(async () => null), runs: vi.fn() },
  storyContext: { get: vi.fn(async () => null) },
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

import StoryDetailPage from './StoryDetailPage'
import { ApiError } from '../../lib/admin-api'

const story = {
  id: 'story-1',
  slug: 'rivers-recover',
  sourceUrl: 'https://example.com/a',
  sourceTitle: 'Source headline',
  sourceDatePublished: null,
  sourceContent: null,
  title: 'Rivers recover',
  titleLabel: null,
  status: 'published',
  issueId: null,
  relevancePre: 6,
  relevance: 7,
  emotionTag: 'calm',
  summary: 'Summary.',
  quote: null,
  quoteAttribution: null,
  marketingBlurb: null,
  relevanceReasons: null,
  relevanceSummary: null,
  antifactors: null,
  relevanceCalculation: null,
  datePublished: '2026-11-10T00:00:00Z',
  clusterId: null,
  cluster: null,
  feed: null,
  preResearch: null,
  _count: { blueskyPosts: 0, mastodonPosts: 0 },
} as unknown as Story

/** A page a story is opened from: its link carries the way back, as the stories list's does. */
function Opener() {
  const location = useLocation()
  return (
    <>
      <output data-testid="at">{location.pathname + location.search}</output>
      <Link to={storyPath('story-1')} state={returnState(location)}>
        Open the story
      </Link>
    </>
  )
}

function renderPage(history: string[]) {
  return renderAdminRoutes(
    [
      { path: '/admin/stories', element: <Opener /> },
      { path: '/admin/newsletters/:id', element: <Opener /> },
      { path: '/admin/stories/:id', element: <StoryDetailPage /> },
    ],
    { history },
  )
}

/** Open the story from the page at `from`, as an editor would. */
async function openFrom(from: string) {
  renderPage([from])
  await userEvent.click(screen.getByRole('link', { name: 'Open the story' }))
  await screen.findByRole('heading', { level: 1, name: 'Rivers recover' })
}

const at = () => screen.getByTestId('at').textContent

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.stories.get.mockResolvedValue(story)
  mockApi.issues.list.mockResolvedValue([])
})

describe('StoryDetailPage', () => {
  it('goes back to the stories list with the filters, sort and page it was opened from', async () => {
    await openFrom('/admin/stories?status=rejected&sort=rating_desc&page=3')
    const back = screen.getByRole('link', { name: 'Back to stories' })
    expect(back).toHaveAttribute('href', '/admin/stories?status=rejected&sort=rating_desc&page=3')
    await userEvent.click(back)
    expect(at()).toBe('/admin/stories?status=rejected&sort=rating_desc&page=3')
  })

  it('goes back to the page it was opened from, named for it', async () => {
    await openFrom('/admin/newsletters/n1')
    await userEvent.click(screen.getByRole('link', { name: 'Back to newsletter' }))
    expect(at()).toBe('/admin/newsletters/n1')
  })

  it('goes back to the stories list when opened from a bookmark', async () => {
    renderPage(['/admin/stories/story-1'])
    await screen.findByRole('heading', { level: 1, name: 'Rivers recover' })
    expect(screen.getByRole('link', { name: 'Back to stories' })).toHaveAttribute('href', '/admin/stories')
  })

  it('returns there on Cancel, and after a save', async () => {
    await openFrom('/admin/stories?status=all')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(at()).toBe('/admin/stories?status=all')

    mockApi.stories.update.mockResolvedValue({ ...story, title: 'Rivers recover fast' })
    await userEvent.click(screen.getByRole('link', { name: 'Open the story' }))
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Rivers recover fast' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(at()).toBe('/admin/stories?status=all'))
    expect(mockApi.stories.update).toHaveBeenCalledWith('story-1', expect.objectContaining({ title: 'Rivers recover fast' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before Back to stories throws unsaved edits away', async () => {
    await openFrom('/admin/stories?status=all&page=2')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } })
    await userEvent.click(screen.getByRole('link', { name: 'Back to stories' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(at()).toBe('/admin/stories?status=all&page=2'))
  })

  it('keeps the tab in the address and the way back as it was, across a tab switch and a reload', async () => {
    const { router } = renderPage(['/admin/stories?status=rejected&page=2'])
    await userEvent.click(screen.getByRole('link', { name: 'Open the story' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Assessment' }))
    await waitFor(() => expect(router.state.location.search).toBe('?tab=assessment'))
    expect(screen.getByRole('link', { name: 'Back to stories' })).toHaveAttribute('href', '/admin/stories?status=rejected&page=2')

    // A reload keeps the history entry, its address and its state
    const { pathname, search, state } = router.state.location
    await act(() => router.navigate(`${pathname}${search}`, { replace: true, state }))
    expect(await screen.findByRole('tab', { name: 'Assessment' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('link', { name: 'Back to stories' }))
    expect(at()).toBe('/admin/stories?status=rejected&page=2')
  })

  it('drafts the published story’s social posts in their panels', async () => {
    mockApi.bluesky.generateDraft.mockReturnValue(new Promise(() => {}))
    await openFrom('/admin/stories')
    await userEvent.click(screen.getByRole('tab', { name: 'Social' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate Bluesky Post' }))
    expect(mockApi.bluesky.generateDraft).toHaveBeenCalledWith('story-1')
    expect(await screen.findByRole('dialog', { name: 'Post to Bluesky' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate Mastodon Post', hidden: true })).toBeInTheDocument()
  })

  it('says the story is not there when the server has none by that id', async () => {
    mockApi.stories.get.mockRejectedValue(new ApiError(404, 'Story not found'))
    renderPage(['/admin/stories/gone'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Story not found' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to stories' })).toBeInTheDocument()
  })

  it('offers a retry when the story could not load', async () => {
    mockApi.stories.get.mockRejectedValueOnce(new ApiError(500, 'Internal error')).mockResolvedValue(story)
    renderPage(['/admin/stories/story-1'])
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Rivers recover' })).toBeInTheDocument()
  })
})
