import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link, useNavigate } from 'react-router-dom'
import type { Story } from '@shared/types'
import { renderAdminRoutes, reloadIsHeld, Where } from '../../test/admin'

const mockApi = vi.hoisted(() => ({ update: vi.fn(), dissolveCluster: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { stories: mockApi },
}))

import { StoryEditForm } from './StoryEditForm'

const story = {
  id: 'story-1',
  slug: 'story-1',
  sourceUrl: 'https://example.com/a',
  sourceTitle: 'Source headline',
  sourceDatePublished: null,
  sourceContent: null,
  title: 'Headline',
  titleLabel: 'Label',
  status: 'analyzed',
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
  datePublished: null,
  clusterId: null,
  cluster: null,
  feed: null,
} as unknown as Story

/** The story's edit page as `StoryDetailPage` mounts it: Save and Cancel go back to the list. */
function EditPage() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/admin/feeds">Feeds</Link>
      <StoryEditForm story={story} issues={[]} onDone={() => navigate('/admin/stories')} />
      <Where />
    </>
  )
}

function renderPage() {
  return renderAdminRoutes(
    [{ path: '/admin/stories/:id', element: <EditPage /> }, { path: '*', element: <Where /> }],
    { history: ['/admin/stories', '/admin/stories/story-1'] },
  )
}

const where = () => screen.getByTestId('where').textContent
const editTitle = () => fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited headline' } })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StoryEditForm unsaved changes', () => {
  it('holds an in-app link while edits are unsaved, and follows it once the discard is confirmed', async () => {
    renderPage()
    editTitle()
    fireEvent.click(screen.getByRole('link', { name: 'Feeds' }))
    const dialog = await screen.findByRole('dialog')
    expect(where()).toBe('/admin/stories/story-1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(where()).toBe('/admin/feeds'))
  })

  it('holds the browser Back button while edits are unsaved, and stays on cancel', async () => {
    const { router } = renderPage()
    editTitle()
    await act(() => router.navigate(-1))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(where()).toBe('/admin/stories/story-1')
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edited headline')
  })

  it('asks the browser to hold a reload only while edits are unsaved', () => {
    renderPage()
    expect(reloadIsHeld()).toBe(false)
    editTitle()
    expect(reloadIsHeld()).toBe(true)
  })

  it('lets Back through at once when nothing is unsaved', async () => {
    const { router } = renderPage()
    await act(() => router.navigate(-1))
    await waitFor(() => expect(where()).toBe('/admin/stories'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves for the list without asking once the edits are saved', async () => {
    mockApi.update.mockResolvedValue({ ...story, title: 'Edited headline' })
    renderPage()
    editTitle()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(where()).toBe('/admin/stories'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
