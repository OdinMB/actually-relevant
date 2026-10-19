import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { ToastProvider } from '../../components/ui/Toast'
import { adminApi } from '../../lib/admin-api'
import BlueskyPage from './BlueskyPage'
import MastodonPage from './MastodonPage'
import { BlueskyDraftPanel } from '../../components/admin/BlueskyDraftPanel'
import { MastodonDraftPanel } from '../../components/admin/MastodonDraftPanel'

vi.mock('../../lib/admin-api', () => ({
  adminApi: {
    bluesky: { getFeed: vi.fn(), deletePost: vi.fn(), refreshMetrics: vi.fn() },
    mastodon: { getFeed: vi.fn(), deletePost: vi.fn(), refreshMetrics: vi.fn() },
  },
}))

const common = { storyTitle: 'A story', storySlug: null, issueName: 'Planet', dbStatus: null }
const bskyItem = (n: number, tracked: boolean) => ({
  ...common, uri: `at://did:plc:x/app.bsky.feed.post/r${n}`, cid: 'c', text: `bsky ${n}`,
  createdAt: '2020-01-01T00:00:00Z', indexedAt: '2020-01-02T00:00:00Z',
  likeCount: 4, repostCount: 1, replyCount: 2, quoteCount: 3, isRepost: false, trackedPostId: tracked ? `bp${n}` : null,
})
const mastoItem = (n: number, tracked: boolean) => ({
  ...common, id: `m${n}`, url: `https://mastodon.social/@x/${n}`, text: `masto ${n}`, createdAt: '2020-01-02T00:00:00Z',
  favouriteCount: 6, boostCount: 1, replyCount: 2, isReblog: true, trackedPostId: tracked ? `mp${n}` : null,
})

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <HelmetProvider><QueryClientProvider client={client}><MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter></QueryClientProvider></HelmetProvider>,
  )
}

describe('social channel pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('Bluesky pages with its cursor and links each post to bsky.app', async () => {
    vi.mocked(adminApi.bluesky.getFeed)
      .mockResolvedValueOnce({ feed: [bskyItem(1, true)], cursor: 'cur-1', dbOnlyPosts: [] })
      .mockResolvedValueOnce({ feed: [bskyItem(2, false)], cursor: undefined, dbOnlyPosts: [] })
    wrap(<BlueskyPage />)

    await screen.findByText('bsky 1')
    expect(adminApi.bluesky.getFeed).toHaveBeenLastCalledWith({ limit: 25 })
    expect(screen.getByText('Avg Likes').previousSibling).toHaveTextContent('4')
    expect(screen.getByText('4L 1R 2C 3Q')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View on Bluesky' })).toHaveAttribute('href', 'https://bsky.app/profile/did:plc:x/post/r1')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load More' })) })
    await screen.findByText('bsky 2')
    expect(adminApi.bluesky.getFeed).toHaveBeenLastCalledWith({ cursor: 'cur-1', limit: 25 })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    expect(window.confirm).toHaveBeenCalledWith('Delete this post? Published posts will also be removed from Bluesky.')
    expect(adminApi.bluesky.deletePost).toHaveBeenCalledWith('bp1')
    expect(adminApi.mastodon.getFeed).not.toHaveBeenCalled()
  })

  it('Mastodon pages with maxId, labels reblogs and averages favourites', async () => {
    vi.mocked(adminApi.mastodon.getFeed)
      .mockResolvedValueOnce({ feed: [mastoItem(1, true)], nextMaxId: 'm1', dbOnlyPosts: [] })
      .mockResolvedValueOnce({ feed: [mastoItem(2, false)], nextMaxId: undefined, dbOnlyPosts: [] })
    vi.mocked(adminApi.mastodon.refreshMetrics).mockResolvedValue(undefined as never)
    wrap(<MastodonPage />)

    await screen.findByText('masto 1')
    expect(adminApi.mastodon.getFeed).toHaveBeenLastCalledWith({ limit: 25 })
    expect(screen.getByText('Avg Favourites').previousSibling).toHaveTextContent('6')
    expect(screen.getByText('6F 1B 2R')).toBeInTheDocument()
    expect(screen.getByText('Reblog')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load More' })) })
    await screen.findByText('masto 2')
    expect(adminApi.mastodon.getFeed).toHaveBeenLastCalledWith({ maxId: 'm1', limit: 25 })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh Metrics' })) })
    await waitFor(() => expect(adminApi.mastodon.refreshMetrics).toHaveBeenCalledTimes(1))
    expect(adminApi.bluesky.refreshMetrics).not.toHaveBeenCalled()
  })
})

describe('social draft panels', () => {
  const draft = {
    id: 'p9', postText: 'Hi',
    story: { title: 'T', titleLabel: null, sourceUrl: 'https://src.example/a', slug: 'a', feed: { title: 'F', displayTitle: null } },
  }
  const handlers = () => ({
    onClose: vi.fn(), onPublish: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined),
  })

  it('Bluesky counts graphemes against 300, saves an edit and then publishes', async () => {
    const h = handlers()
    wrap(<BlueskyDraftPanel open draft={draft} {...h} />)
    const box = await screen.findByLabelText('Post text')
    fireEvent.change(box, { target: { value: '👍🏽👍🏽' } }) // two graphemes, eight UTF-16 units
    expect(screen.getByText('2/300')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post to Bluesky' })) })
    expect(h.onUpdate).toHaveBeenCalledWith('p9', '👍🏽👍🏽')
    expect(h.onPublish).toHaveBeenCalledWith('p9')
  })

  it('Mastodon counts characters against 500 and blocks posting over the limit', async () => {
    wrap(<MastodonDraftPanel open draft={draft} {...handlers()} />)
    const box = await screen.findByLabelText('Post text')
    fireEvent.change(box, { target: { value: 'x'.repeat(501) } })
    expect(screen.getByText('501/500')).toHaveClass('text-red-600')
    expect(screen.getByRole('button', { name: 'Post to Mastodon' })).toBeDisabled()
  })
})
