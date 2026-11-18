import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router-dom'
import type { PaginatedResponse, Story } from '@shared/types'
import { renderAdminRoutes } from '../../test/admin'
import { BackgroundTaskProvider } from '../../hooks/useBackgroundTasks'
import { backLink } from '../../components/admin/storyReturn'

const mockApi = vi.hoisted(() => ({
  stories: { list: vi.fn(), delete: vi.fn(), updateStatus: vi.fn(), bulkStatus: vi.fn(), preassess: vi.fn(), assess: vi.fn(), publish: vi.fn() },
  feeds: { list: vi.fn() },
  issues: { list: vi.fn() },
  research: { usage: vi.fn() },
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

import StoriesPage from './StoriesPage'

/** The story's page, as far as these tests go: where it is, and where its back link goes. */
function StoryPageStub() {
  const location = useLocation()
  return (
    <output data-testid="story">
      {location.pathname} back to {backLink(location.state).to}
    </output>
  )
}

/** The list's address, for asserting what its filters and paging wrote there. */
function At() {
  const location = useLocation()
  return <output data-testid="at">{location.pathname + location.search}</output>
}

const story = (id: string, title: string, status: Story['status']) =>
  ({ id, title, sourceTitle: `${title} (source)`, status, relevance: 7, relevancePre: 6, emotionTag: null, dateCrawled: '2026-11-10T00:00:00Z' }) as Story

const stories = [
  story('s-1', 'Rivers recover', 'published'),
  story('s-2', 'Forests return', 'fetched'),
  story('s-3', 'Clean air act passes', 'pre_analyzed'),
  story('s-4', 'Wetlands restored', 'analyzed'),
]

const listPage = (data: Story[], more: Partial<PaginatedResponse<Story>> = {}): PaginatedResponse<Story> => ({
  data,
  total: data.length,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  ...more,
})

function renderList(history = ['/admin/stories']) {
  return renderAdminRoutes(
    [
      {
        path: '/admin/stories',
        element: (
          <BackgroundTaskProvider>
            <StoriesPage />
            <At />
          </BackgroundTaskProvider>
        ),
      },
      { path: '/admin/stories/:id', element: <StoryPageStub /> },
    ],
    { history },
  )
}

const at = () => screen.getByTestId('at').textContent
/** The table row of the story with this title, once the list has loaded. */
async function row(title: string) {
  await screen.findByRole('link', { name: title })
  return screen.getByRole('row', { name: new RegExp(title) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.stories.list.mockResolvedValue(listPage(stories))
  mockApi.feeds.list.mockResolvedValue([])
  mockApi.issues.list.mockResolvedValue([])
  mockApi.research.usage.mockResolvedValue({ enabled: true, refusal: null, applyRefusal: null, monthToDateUsd: 0 })
})

describe('StoriesPage', () => {
  it('sends an old link to the list’s open panel to the story’s page, which goes back to the list with the link’s filters', async () => {
    const { router } = renderList(['/admin/stories?status=rejected&open=story-7&page=2'])
    expect(await screen.findByTestId('story')).toHaveTextContent('/admin/stories/story-7 back to /admin/stories?status=rejected&page=2')
    // In place of the list's entry, so Back does not land on the redirect again
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('shows published stories on a first visit, and opens one on its page, whose back link returns to the list as it was', async () => {
    renderList()
    const title = await screen.findByRole('link', { name: 'Rivers recover' })
    await waitFor(() => expect(mockApi.stories.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published', page: 1, pageSize: 25 })))
    expect(at()).toBe('/admin/stories?status=published')
    await userEvent.click(title)
    expect(await screen.findByTestId('story')).toHaveTextContent('/admin/stories/s-1 back to /admin/stories?status=published')
  })

  it('runs a story’s next pipeline step from its row', async () => {
    mockApi.stories.preassess.mockResolvedValue({ processed: 1 })
    mockApi.stories.assess.mockResolvedValue(stories[2])
    mockApi.stories.publish.mockResolvedValue(stories[3])
    renderList()
    await userEvent.click(within(await row('Forests return')).getByRole('button', { name: 'Pre-assess' }))
    await userEvent.click(within(await row('Clean air act passes')).getByRole('button', { name: 'Assess' }))
    await userEvent.click(within(await row('Wetlands restored')).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mockApi.stories.publish).toHaveBeenCalledWith('s-4'))
    expect(mockApi.stories.preassess).toHaveBeenCalledWith(['s-2'])
    expect(mockApi.stories.assess).toHaveBeenCalledWith('s-3')
  })

  it('deletes a story once the delete is confirmed', async () => {
    mockApi.stories.delete.mockResolvedValue(undefined)
    renderList()
    await userEvent.click(within(await row('Rivers recover')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Delete story?')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Story deleted')).toBeInTheDocument()
    expect(mockApi.stories.delete).toHaveBeenCalledWith('s-1')
  })

  it('says why a confirmed delete failed', async () => {
    mockApi.stories.delete.mockRejectedValue(new Error('The story is in a sent newsletter'))
    renderList()
    await userEvent.click(within(await row('Rivers recover')).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('The story is in a sent newsletter')).toBeInTheDocument()
  })

  it('sets the status of the selected stories once confirmed', async () => {
    mockApi.stories.bulkStatus.mockResolvedValue({ updated: 4 })
    renderList()
    await row('Rivers recover')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Rivers recover' }))
    expect(screen.getByRole('checkbox', { name: 'Select Rivers recover' })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all stories' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(mockApi.stories.bulkStatus).toHaveBeenCalledWith(['s-1', 's-2', 's-3', 's-4'], 'rejected'))
    expect(await screen.findByText('Updated 4 stories')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select all stories' })).not.toBeChecked()
  })

  it('changes one story’s status from its row menu, and says when that fails', async () => {
    // jsdom has no ResizeObserver; the menu only uses it to place its items
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
    mockApi.stories.updateStatus.mockResolvedValueOnce({ ...stories[0], status: 'rejected' }).mockRejectedValueOnce(new Error('offline'))
    renderList()
    await userEvent.click(within(await row('Rivers recover')).getByRole('button', { expanded: false }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reject' }))
    expect(await screen.findByText('Status updated')).toBeInTheDocument()
    expect(mockApi.stories.updateStatus).toHaveBeenCalledWith('s-1', 'rejected')

    await userEvent.click(within(await row('Forests return')).getByRole('button', { expanded: false }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Trash' }))
    expect(await screen.findByText('Failed to update status')).toBeInTheDocument()
  })

  it('pages through the list and changes its page size in the address', async () => {
    mockApi.stories.list.mockResolvedValue(listPage(stories, { total: 60, totalPages: 3 }))
    renderList(['/admin/stories?status=published'])
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await waitFor(() => expect(at()).toBe('/admin/stories?status=published&page=2'))
    await userEvent.selectOptions(screen.getByLabelText('Show'), '50')
    await waitFor(() => expect(at()).toBe('/admin/stories?status=published&page=1&pageSize=50'))
  })

  it('says when no story matches, and offers a retry when the list fails to load', async () => {
    mockApi.stories.list.mockResolvedValue(listPage([]))
    const { unmount } = renderList(['/admin/stories?status=rejected'])
    expect(await screen.findByText('No stories found')).toBeInTheDocument()
    unmount()

    mockApi.stories.list.mockRejectedValueOnce(new Error('offline'))
    renderList(['/admin/stories?status=rejected'])
    expect(await screen.findByText('Failed to load stories')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No stories found')).toBeInTheDocument()
  })
})
