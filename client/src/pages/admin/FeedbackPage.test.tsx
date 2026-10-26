import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { FeedbackItem } from '../../lib/admin-api'
import { renderAdminRoutes } from '../../test/admin'
import FeedbackPage from './FeedbackPage'

const mockApi = vi.hoisted(() => ({
  feedback: { list: vi.fn(), updateStatus: vi.fn(), delete: vi.fn(), bulk: vi.fn() },
}))

vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: mockApi,
}))

function item(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: 'fb-1',
    category: 'general',
    message: 'Great site',
    email: null,
    status: 'read',
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    storyId: null,
    story: null,
    ...overrides,
  }
}

const CORRECTION = item({
  id: 'fb-2',
  category: 'correction',
  message: 'The date is wrong',
  storyId: 'story-1',
  story: { id: 'story-1', slug: 'clean-air', title: 'Cities cut smog', sourceTitle: 'Smog falls', status: 'published' },
})
const ORPHANED = item({ id: 'fb-3', category: 'correction', message: 'Name misspelled', storyId: null, story: null })

function renderPage(path = '/admin/feedback') {
  return renderAdminRoutes([{ path: '/admin/feedback', element: <FeedbackPage /> }], { history: [path] })
}

describe('Admin FeedbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.feedback.list.mockResolvedValue({ items: [item(), CORRECTION, ORPHANED], total: 3, page: 1, limit: 25, unreadCount: 0 })
  })

  it('links a correction to the story it was reported from', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: 'Cities cut smog' })
    expect(link.getAttribute('href')).toBe('/stories/clean-air')
    // A correction without a story is one sent from a story since deleted (or from elsewhere)
    expect(screen.getByText('Story deleted or not given')).toBeInTheDocument()
  })

  it('filters by the correction category', async () => {
    renderPage()
    await screen.findByText('The date is wrong')
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by category' }), { target: { value: 'correction' } })
    await waitFor(() => expect(mockApi.feedback.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'correction' })))
  })
})
