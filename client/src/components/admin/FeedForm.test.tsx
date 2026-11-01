import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Issue } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { adminApi } from '../../lib/admin-api'
import { FeedCreateForm } from './FeedForm'

vi.mock('../../lib/admin-api', () => ({
  adminApi: { feeds: { create: vi.fn() } },
}))

const createMock = vi.mocked(adminApi.feeds.create)

const issues = [{ id: 'issue-1', name: 'Planet & Climate', slug: 'planet-climate', parentId: null }] as unknown as Issue[]

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <FeedCreateForm open onClose={() => {}} issues={issues} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('FeedCreateForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMock.mockResolvedValue({} as Awaited<ReturnType<typeof adminApi.feeds.create>>)
  })

  it('saves where the article text comes from, the article page unless changed', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A Newsletter' } })
    fireEvent.change(screen.getByLabelText('RSS URL'), { target: { value: 'https://writer.substack.com/feed' } })
    fireEvent.change(screen.getByLabelText('Issue'), { target: { value: 'issue-1' } })
    expect(screen.getByLabelText('Article text')).toHaveValue('page')

    fireEvent.change(screen.getByLabelText('Article text'), { target: { value: 'rss' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1))
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ title: 'A Newsletter', issueId: 'issue-1', contentSource: 'rss' })
  })
})
