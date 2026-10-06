import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { PodcastPoolStory } from '@shared/types'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ storyPool: vi.fn(), saveStories: vi.fn(), active: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastStoryPicker, swapStory } from './PodcastStoryPicker'

const story = (n: number, selected: boolean): PodcastPoolStory => ({
  id: `s${n}`, title: `Story ${n}`, publisher: `Pub ${n}`, sourceUrl: `https://x.example/${n}`, slug: null, issue: `Issue ${n}`, relevance: 8, selected,
})

function setPool(chosen: number) {
  mockApi.storyPool.mockResolvedValue({
    stories: [1, 2, 3, 4, 5, 6].map(n => story(n, n <= chosen)),
    minStories: 4,
    maxStories: 5,
  })
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`)

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.active.mockResolvedValue([])
})

describe('swapStory', () => {
  it('replaces the story in its place', () => {
    expect(swapStory(['a', 'b', 'c'], 1, 'z')).toEqual(['a', 'z', 'c'])
  })
})

describe('PodcastStoryPicker', () => {
  it('shows title, publisher and issue, and disables remove at the minimum', async () => {
    setPool(4)
    renderInAdmin(<PodcastStoryPicker podcast={makePodcast({ stage: 'selected', storyIds: ids(4) })} />)
    expect(await screen.findByText('Story 1')).toBeTruthy()
    expect(screen.getAllByText('(Pub 1, Issue 1)').length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: 'Remove story 1' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables add at the maximum', async () => {
    setPool(5)
    renderInAdmin(<PodcastStoryPicker podcast={makePodcast({ stage: 'selected', storyIds: ids(5) })} />)
    expect(((await screen.findByRole('button', { name: 'Add Story 6' })) as HTMLButtonElement).disabled).toBe(true)
  })

  it('swaps a story in place and saves the new order', async () => {
    setPool(4)
    mockApi.saveStories.mockResolvedValue(makePodcast({ stage: 'selected', storyIds: ['s1', 's6', 's3', 's4'] }))
    renderInAdmin(<PodcastStoryPicker podcast={makePodcast({ stage: 'selected', storyIds: ids(4) })} />)
    fireEvent.change(await screen.findByLabelText('Swap story 2 for another story'), { target: { value: 's6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save stories' }))
    await waitFor(() => expect(mockApi.saveStories).toHaveBeenCalledWith('pod-1', ['s1', 's6', 's3', 's4']))
  })

  it('reports the change to the page so approval waits for a save', async () => {
    setPool(4)
    const onDirtyChange = vi.fn()
    renderInAdmin(<PodcastStoryPicker podcast={makePodcast({ stage: 'selected', storyIds: ids(4) })} onDirtyChange={onDirtyChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add Story 5' }))
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })
})
