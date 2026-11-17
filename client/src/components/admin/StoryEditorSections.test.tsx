import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Story } from '@shared/types'

const mockApi = vi.hoisted(() => ({ dissolveCluster: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { stories: mockApi },
}))

import { ClusterSection, SocialPostsSection, SourceSection } from './StoryEditorSections'

const story = {
  id: 'story-1',
  sourceUrl: 'https://example.com/a',
  sourceTitle: 'Source headline',
  sourceDatePublished: null,
  sourceContent: 'The full article text.',
  accessTier: 'metered',
  title: 'Rivers recover',
  status: 'published',
  clusterId: null,
  cluster: null,
  feed: { title: 'Example Feed' },
  _count: { blueskyPosts: 0, mastodonPosts: 0 },
} as unknown as Story

function renderSection(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SourceSection', () => {
  it('shows where the story was crawled from, its text behind a toggle', async () => {
    renderSection(<SourceSection story={story} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Source' })).toBeInTheDocument()
    expect(screen.getByText('Example Feed')).toBeInTheDocument()
    expect(screen.getByText('Marked paid, full text received')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show source content' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('The full article text.')).not.toBeVisible()
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide content' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('The full article text.')).toBeVisible()
  })

  it('says when the access tier is unclassified, and names a tier it does not know as it is', () => {
    const { unmount } = renderSection(<SourceSection story={{ ...story, accessTier: null, sourceContent: null } as unknown as Story} />)
    expect(screen.getByText('Not classified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show source content' })).toBeNull()
    unmount()
    renderSection(<SourceSection story={{ ...story, accessTier: 'gated' } as unknown as Story} />)
    expect(screen.getByText('gated')).toBeInTheDocument()
  })
})

describe('ClusterSection', () => {
  const member = {
    ...story,
    clusterId: 'cluster-1',
    cluster: {
      id: 'cluster-1',
      primaryStoryId: 'story-2',
      _count: { stories: 2 },
      stories: [
        { id: 'story-1', title: 'Rivers recover', sourceTitle: 'Source headline', status: 'analyzed' },
        { id: 'story-2', title: null, sourceTitle: 'Rivers are recovering', status: 'published' },
      ],
    },
  } as unknown as Story

  it('offers to start a cluster with a story outside one', () => {
    renderSection(<ClusterSection story={story} />)
    expect(screen.getByRole('link', { name: 'Create cluster with this story' })).toHaveAttribute('href', '/admin/clusters?create=story-1')
  })

  it('shows a member’s role and the cluster’s other stories, with a link to manage it', () => {
    renderSection(<ClusterSection story={member} />)
    expect(screen.getByText('Member')).toBeInTheDocument()
    expect(screen.getByText('2 stories')).toBeInTheDocument()
    expect(screen.getByText('Rivers are recovering')).toBeInTheDocument()
    expect(screen.getByText('(Primary)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage cluster' })).toHaveAttribute('href', '/admin/clusters?open=cluster-1')
  })

  it('shows the primary as such', () => {
    renderSection(<ClusterSection story={{ ...member, cluster: { ...member.cluster!, primaryStoryId: 'story-1' } }} />)
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('dissolves the cluster only once confirmed, and lets the confirm be cancelled', async () => {
    mockApi.dissolveCluster.mockResolvedValue({ ...member, clusterId: null, cluster: null })
    renderSection(<ClusterSection story={member} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dissolve cluster' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockApi.dissolveCluster).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Dissolve cluster' }))
    expect(screen.getByText('Dissolve cluster and restore members to analyzed?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dissolve cluster' })).toBeInTheDocument())
    expect(mockApi.dissolveCluster).toHaveBeenCalledWith('story-1')
  })
})

describe('SocialPostsSection', () => {
  it('shows nothing for a story that is not published', () => {
    const { container } = renderSection(<SocialPostsSection story={{ ...story, status: 'analyzed' }} onBlueskyGenerate={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('drafts a post for each channel the story has none on', async () => {
    const onBlueskyGenerate = vi.fn()
    const onMastodonGenerate = vi.fn()
    renderSection(<SocialPostsSection story={story} onBlueskyGenerate={onBlueskyGenerate} onMastodonGenerate={onMastodonGenerate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate Bluesky Post' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate Mastodon Post' }))
    expect(onBlueskyGenerate).toHaveBeenCalledWith('story-1')
    expect(onMastodonGenerate).toHaveBeenCalledWith('story-1')
  })

  it('links to the posts a story already has', () => {
    const posted = {
      ...story,
      _count: { blueskyPosts: 1, mastodonPosts: 1 },
      blueskyPosts: [{ postUri: 'at://did:plc:abc/app.bsky.feed.post/xyz' }],
      mastodonPosts: [{ statusUrl: 'https://mastodon.example/@ar/1' }],
    } as unknown as Story
    renderSection(<SocialPostsSection story={posted} onBlueskyGenerate={vi.fn()} onMastodonGenerate={vi.fn()} />)
    expect(screen.getByText(/posted to Bluesky/)).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'View post' })
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('xyz'))
    expect(links[1]).toHaveAttribute('href', 'https://mastodon.example/@ar/1')
  })
})
