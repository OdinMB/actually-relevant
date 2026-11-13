import { useState } from 'react'
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
// The research section has its own tests (StoryResearch.test.tsx) and needs the background-task provider
vi.mock('./StoryResearch', () => ({ StoryResearch: () => null }))

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

/**
 * The story's edit page as `StoryDetailPage` mounts it: Save and Cancel go back to the list.
 * "Refetch" swaps in `refetched`, as the story query does after an apply or a revert.
 */
function EditPage({ shown, refetched }: { shown: Story; refetched?: Story }) {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(shown)
  return (
    <>
      <Link to="/admin/feeds">Feeds</Link>
      {refetched && (
        <button type="button" onClick={() => setCurrent(refetched)}>
          Refetch
        </button>
      )}
      <StoryEditForm story={current} issues={[]} onDone={() => navigate('/admin/stories')} />
      <Where />
    </>
  )
}

function renderPage(shown: Story = story, refetched?: Story) {
  return renderAdminRoutes(
    [
      { path: '/admin/stories/:id', element: <EditPage shown={shown} refetched={refetched} /> },
      { path: '*', element: <Where /> },
    ],
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

describe('StoryEditForm on a researched story', () => {
  const swapped = ['Title Label', 'Title', 'Summary', 'Quote', 'Quote Attribution', 'Marketing Blurb', 'Relevance Reasons', 'Relevance Summary', 'Antifactors']
  const field = (label: string) => screen.getByLabelText(label, { exact: true })

  it('locks the fields its researched version wrote, says why, and leaves the others editable, the rating among them', () => {
    renderPage({ ...story, preResearch: { title: 'Single-source headline' } })
    for (const label of swapped) {
      expect(field(label)).toBeDisabled()
      expect(field(label)).toHaveAccessibleDescription(/Revert to single-source first/)
    }
    expect(screen.getByText(/Revert to single-source first/)).toBeInTheDocument()
    // Research never writes the rating or its calculation
    for (const label of ['Rating', 'Relevance Calculation', 'Pre-rating', 'Status']) expect(field(label)).toBeEnabled()
  })

  it('locks nothing on a single-source story', () => {
    renderPage({ ...story, preResearch: null })
    for (const label of swapped) expect(field(label)).toBeEnabled()
    expect(screen.queryByText(/Revert to single-source first/)).toBeNull()
  })

  describe('when a revert or an apply lands while other edits are unsaved', () => {
    const singleSource = { ...story, title: 'Single-source headline', summary: 'Single-source summary.', preResearch: null } as Story
    const researched = { ...story, title: 'Researched headline', summary: 'Researched summary.', preResearch: { title: 'Single-source headline' } } as Story
    const editEmotion = () => fireEvent.change(field('Emotion'), { target: { value: 'uplifting' } })
    const save = async () => {
      mockApi.update.mockResolvedValue(story)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(mockApi.update).toHaveBeenCalled())
      return mockApi.update.mock.calls[0]![1] as Partial<Story>
    }

    it('after a revert, shows and saves the single-source fields, keeping the other edits', async () => {
      renderPage(researched, singleSource)
      editEmotion()
      fireEvent.click(screen.getByRole('button', { name: 'Refetch' }))

      expect(field('Title')).toHaveValue('Single-source headline')
      expect(field('Title')).toBeEnabled()
      expect(field('Emotion')).toHaveValue('uplifting')
      expect(await save()).toMatchObject({ title: 'Single-source headline', summary: 'Single-source summary.', emotionTag: 'uplifting' })
    })

    it('after an apply, shows and saves the researched fields, keeping the other edits', async () => {
      renderPage(singleSource, researched)
      editEmotion()
      fireEvent.click(screen.getByRole('button', { name: 'Refetch' }))

      expect(field('Title')).toHaveValue('Researched headline')
      expect(field('Title')).toBeDisabled()
      expect(field('Emotion')).toHaveValue('uplifting')
      expect(await save()).toMatchObject({ title: 'Researched headline', summary: 'Researched summary.', emotionTag: 'uplifting' })
    })
  })
})
