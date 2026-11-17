import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link, useNavigate } from 'react-router-dom'
import type { Story } from '@shared/types'
import { renderAdminRoutes, reloadIsHeld, Where } from '../../test/admin'

const mockApi = vi.hoisted(() => ({ update: vi.fn(), dissolveCluster: vi.fn(), publish: vi.fn() }))
// A backend without research or context, so the page has neither tab nor action (each has its own tests)
const mockSections = vi.hoisted(() => ({
  research: { usage: vi.fn(async () => null), runs: vi.fn() },
  storyContext: { get: vi.fn(async () => null) },
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { stories: mockApi, ...mockSections },
}))
// The research section has its own tests (StoryResearch.test.tsx) and needs the background-task provider
vi.mock('./StoryResearch', () => ({ StoryResearch: () => null }))
// So has the context section (StoryContextAdmin.test.tsx)
vi.mock('./StoryContextAdmin', () => ({ StoryContextAdmin: () => null }))

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
 * The story's edit page as `StoryDetailPage` mounts it: Cancel goes back to the list (staying after
 * a save, as the story query brings in the saved story, is `StoryDetailPage.test.tsx`'s). "Refetch"
 * swaps in `refetched`, as the story query does after an apply or a revert.
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
      <StoryEditForm story={current} issues={[]} onCancel={() => navigate('/admin/stories')} />
      <Where />
    </>
  )
}

function renderPage(shown: Story = story, refetched?: Story, address = '/admin/stories/story-1') {
  return renderAdminRoutes(
    [
      { path: '/admin/stories/:id', element: <EditPage shown={shown} refetched={refetched} /> },
      { path: '*', element: <Where /> },
    ],
    { history: ['/admin/stories', address] },
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

  it('has nothing unsaved once an edited rating is typed back to what it was', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '8' } })
    expect(reloadIsHeld()).toBe(true)
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '7' } })
    expect(reloadIsHeld()).toBe(false)
  })

  it('lets Back through at once when nothing is unsaved', async () => {
    const { router } = renderPage()
    await act(() => router.navigate(-1))
    await waitFor(() => expect(where()).toBe('/admin/stories'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('StoryEditForm tabs', () => {
  const tab = (name: string | RegExp) => screen.getByRole('tab', { name })

  it('opens on the story’s text, keeps an edit while another tab shows, and marks the tab holding it', async () => {
    const { router } = renderPage()
    expect(tab('Story')).toHaveAttribute('aria-selected', 'true')
    // Against a backend without research, its tab goes once that is known
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Research' })).toBeNull())
    editTitle()
    fireEvent.click(tab('Source'))
    expect(tab('Source')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Source' })).toBeVisible()
    expect(screen.getByLabelText('Title')).not.toBeVisible()
    expect(tab('Story, unsaved changes')).toBeInTheDocument()
    expect(tab('Assessment')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe('?tab=source'))

    fireEvent.click(tab(/^Story/))
    expect(screen.getByLabelText('Title')).toHaveValue('Edited headline')
    // A tab switch is the page's own state, never a way off it
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the tab the address names, and the story’s text for a tab it does not have', () => {
    const first = renderPage(story, undefined, '/admin/stories/story-1?tab=assessment')
    expect(tab('Assessment')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Rating')).toBeVisible()
    first.unmount()

    renderPage(story, undefined, '/admin/stories/story-1?tab=social')
    expect(tab('Story')).toHaveAttribute('aria-selected', 'true')
  })

  it('on Save, shows the rating it cannot send, on its tab and focused, and sends nothing', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '12' } })
    expect(tab('Assessment, has a problem')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByLabelText('Rating')).toHaveFocus())
    expect(tab(/^Assessment/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Rating')).toHaveAccessibleDescription('Enter a whole number from 1 to 10')
    expect(mockApi.update).not.toHaveBeenCalled()
  })

  it('throws the unsaved edits away when a story action is confirmed over them', async () => {
    mockApi.publish.mockReturnValue(new Promise(() => {}))
    renderPage()
    editTitle()
    fireEvent.click(within(screen.getByRole('region', { name: 'Story actions' })).getByRole('button', { name: 'Publish' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard and publish' }))
    await waitFor(() => expect(mockApi.publish).toHaveBeenCalledWith('story-1'))
    expect(screen.getByLabelText('Title')).toHaveValue('Headline')
    expect(reloadIsHeld()).toBe(false)
  })
})

describe('StoryEditForm saving', () => {
  it('saves what each field holds, a cleared one as empty', async () => {
    mockApi.update.mockResolvedValue(story)
    renderPage({ ...story, preResearch: null } as Story)
    const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } })
    type('Title Label', 'New label')
    type('Title', 'New headline')
    type('Slug', 'new-slug')
    type('Status', 'selected')
    type('Emotion', 'uplifting')
    type('Pre-rating', '')
    type('Rating', '9')
    type('Summary', '')
    type('Quote', 'A quote.')
    type('Quote Attribution', 'Dr. Jane Doe')
    type('Marketing Blurb', 'Blurb.')
    type('Relevance Reasons', 'Reasons.')
    type('Relevance Summary', 'Why it matters.')
    type('Antifactors', 'One region only.')
    type('Relevance Calculation', 'Final rating: 9')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalled())
    expect(mockApi.update.mock.calls[0]![1]).toMatchObject({
      titleLabel: 'New label',
      title: 'New headline',
      slug: 'new-slug',
      issueId: null,
      status: 'selected',
      relevancePre: null,
      relevance: 9,
      emotionTag: 'uplifting',
      summary: null,
      quote: 'A quote.',
      quoteAttribution: 'Dr. Jane Doe',
      marketingBlurb: 'Blurb.',
      relevanceReasons: 'Reasons.',
      relevanceSummary: 'Why it matters.',
      antifactors: 'One region only.',
      relevanceCalculation: 'Final rating: 9',
    })
  })

  it('shows a published story’s slug read-only', () => {
    renderPage({ ...story, datePublished: '2026-11-10T00:00:00Z' } as Story)
    expect(screen.getByLabelText('Slug')).toHaveAttribute('readonly')
  })
})

describe('StoryEditForm on a researched story', () => {
  const swapped = [
    'Title Label',
    'Title',
    'Summary',
    'Quote',
    'Quote Attribution',
    'Marketing Blurb',
    'Relevance Reasons',
    'Relevance Summary',
    'Antifactors',
    'Emotion',
  ]
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
    const singleSource = { ...story, title: 'Single-source headline', summary: 'Single-source summary.', emotionTag: 'frustrating', preResearch: null } as Story
    const researched = {
      ...story,
      title: 'Researched headline',
      summary: 'Researched summary.',
      emotionTag: 'uplifting',
      preResearch: { title: 'Single-source headline', emotionTag: 'frustrating' },
    } as Story
    const editRating = () => fireEvent.change(field('Rating'), { target: { value: '9' } })
    const save = async () => {
      mockApi.update.mockResolvedValue(story)
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(mockApi.update).toHaveBeenCalled())
      return mockApi.update.mock.calls[0]![1] as Partial<Story>
    }

    it('after a revert, shows and saves the single-source fields and emotion tag, keeping the other edits', async () => {
      renderPage(researched, singleSource)
      editRating()
      fireEvent.click(screen.getByRole('button', { name: 'Refetch' }))

      expect(field('Title')).toHaveValue('Single-source headline')
      expect(field('Title')).toBeEnabled()
      expect(field('Emotion')).toHaveValue('frustrating')
      expect(field('Rating')).toHaveValue(9)
      expect(await save()).toMatchObject({ title: 'Single-source headline', summary: 'Single-source summary.', emotionTag: 'frustrating', relevance: 9 })
    })

    it('after an apply, shows and saves the researched fields and emotion tag, keeping the other edits', async () => {
      renderPage(singleSource, researched)
      editRating()
      fireEvent.click(screen.getByRole('button', { name: 'Refetch' }))

      expect(field('Title')).toHaveValue('Researched headline')
      expect(field('Title')).toBeDisabled()
      expect(field('Emotion')).toHaveValue('uplifting')
      expect(field('Rating')).toHaveValue(9)
      expect(await save()).toMatchObject({ title: 'Researched headline', summary: 'Researched summary.', emotionTag: 'uplifting', relevance: 9 })
    })
  })
})
