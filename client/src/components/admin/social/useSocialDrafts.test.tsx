import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../ui/Toast'

const mockApi = vi.hoisted(() => {
  const channel = () => ({ generateDraft: vi.fn(), publishPost: vi.fn(), updateDraft: vi.fn(), deletePost: vi.fn() })
  return { bluesky: channel(), mastodon: channel() }
})
vi.mock('../../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../lib/admin-api')>()),
  adminApi: mockApi,
}))

import { useSocialDrafts } from './useSocialDrafts'

const draft = (postText: string) => ({
  id: 'post-1',
  postText,
  story: { title: 'Headline', titleLabel: null, sourceUrl: 'https://example.com/a', slug: 'headline', feed: { title: 'Feed', displayTitle: null } },
})

/** A page using the hook: one story's drafts, and a bulk draft driving the Mastodon panel as the list's bulk actions do. */
function Harness({ onPublished, bulkDraft }: { onPublished?: () => void; bulkDraft?: Promise<unknown> }) {
  const social = useSocialDrafts({ onPublished })
  const bulk = () => {
    const panel = social.drafts.mastodon
    panel.open()
    bulkDraft?.then(panel.show, panel.close)
  }
  return (
    <>
      <button type="button" onClick={() => social.generate('bluesky', 'story-1')}>
        Draft for Bluesky
      </button>
      <button type="button" onClick={() => social.generate('mastodon', 'story-1')}>
        Draft for Mastodon
      </button>
      <button type="button" onClick={bulk}>
        Pick and draft for Mastodon
      </button>
      {social.panels}
    </>
  )
}

function renderHarness(onPublished?: () => void, bulkDraft?: Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Harness onPublished={onPublished} bulkDraft={bulkDraft} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { invalidate }
}

function deferred() {
  let resolve: (value: unknown) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const panel = (channel: string) => screen.findByRole('dialog', { name: `Post to ${channel}` })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSocialDrafts', () => {
  it('drafts a post for one story in its channel’s panel', async () => {
    mockApi.bluesky.generateDraft.mockResolvedValue(draft('A post about it'))
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Draft for Bluesky' }))
    expect(mockApi.bluesky.generateDraft).toHaveBeenCalledWith('story-1')
    expect(await within(await panel('Bluesky')).findByLabelText('Post text')).toHaveValue('A post about it')
    expect(mockApi.mastodon.generateDraft).not.toHaveBeenCalled()
  })

  it('closes the panel and says why when the draft fails', async () => {
    mockApi.mastodon.generateDraft.mockRejectedValue(new Error('No API key'))
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Draft for Mastodon' }))
    expect(await screen.findByText('No API key')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens a panel empty for a bulk draft, then shows it', async () => {
    const pick = deferred()
    renderHarness(undefined, pick.promise)
    await userEvent.click(screen.getByRole('button', { name: 'Pick and draft for Mastodon' }))
    const dialog = await panel('Mastodon')
    expect(within(dialog).queryByLabelText('Post text')).toBeNull()
    await act(async () => pick.resolve(draft('Picked')))
    expect(await within(dialog).findByLabelText('Post text')).toHaveValue('Picked')
  })

  it('closes a bulk draft’s panel when the bulk action does', async () => {
    const pick = deferred()
    renderHarness(undefined, pick.promise)
    await userEvent.click(screen.getByRole('button', { name: 'Pick and draft for Mastodon' }))
    await panel('Mastodon')
    await act(async () => pick.reject(new Error('none')))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('publishes the post, saving an edit first, then closes, reports and re-reads the stories', async () => {
    mockApi.bluesky.generateDraft.mockResolvedValue(draft('First text'))
    mockApi.bluesky.updateDraft.mockResolvedValue(undefined)
    mockApi.bluesky.publishPost.mockResolvedValue(undefined)
    const onPublished = vi.fn()
    const { invalidate } = renderHarness(onPublished)
    await userEvent.click(screen.getByRole('button', { name: 'Draft for Bluesky' }))
    const dialog = await panel('Bluesky')
    const text = await within(dialog).findByLabelText('Post text')
    await userEvent.clear(text)
    await userEvent.type(text, 'Edited text')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post to Bluesky' }))

    await waitFor(() => expect(mockApi.bluesky.publishPost).toHaveBeenCalledWith('post-1'))
    expect(mockApi.bluesky.updateDraft).toHaveBeenCalledWith('post-1', 'Edited text')
    expect(await screen.findByText('Posted to Bluesky')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onPublished).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['story'] })
  })

  it('keeps the panel open with the error when publishing fails', async () => {
    mockApi.mastodon.generateDraft.mockResolvedValue(draft('Text'))
    mockApi.mastodon.publishPost.mockRejectedValue(new Error('Rate limited'))
    const onPublished = vi.fn()
    renderHarness(onPublished)
    await userEvent.click(screen.getByRole('button', { name: 'Draft for Mastodon' }))
    const dialog = await panel('Mastodon')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Post to Mastodon' }))
    expect(await screen.findByText('Rate limited')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Post to Mastodon' })).toBeInTheDocument()
    expect(onPublished).not.toHaveBeenCalled()
  })

  it('deletes the draft on Cancel, and reports a failed save or delete', async () => {
    mockApi.bluesky.generateDraft.mockResolvedValue(draft('Text'))
    mockApi.bluesky.updateDraft.mockRejectedValue(new Error('Save refused'))
    mockApi.bluesky.deletePost.mockRejectedValue(new Error('Delete refused'))
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Draft for Bluesky' }))
    const dialog = await panel('Bluesky')
    const text = await within(dialog).findByLabelText('Post text')
    await userEvent.type(text, ' more')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post to Bluesky' }))
    expect(await screen.findByText('Save refused')).toBeInTheDocument()
    expect(mockApi.bluesky.publishPost).not.toHaveBeenCalled()

    await act(async () => within(dialog).getByRole('button', { name: 'Cancel' }).click())
    expect(mockApi.bluesky.deletePost).toHaveBeenCalledWith('post-1')
    expect(await screen.findByText('Delete refused')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
