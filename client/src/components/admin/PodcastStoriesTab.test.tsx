import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ usage: vi.fn(), active: vi.fn(), resume: vi.fn(), rewind: vi.fn(), storyPool: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastStoriesTab } from './PodcastStoriesTab'

const noop = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 10800, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
  mockApi.active.mockResolvedValue([])
  mockApi.resume.mockResolvedValue(makePodcast({ inProgress: true }))
  mockApi.rewind.mockResolvedValue(makePodcast({ stage: 'created', inProgress: true }))
  mockApi.storyPool.mockResolvedValue({ stories: [], minStories: 2, maxStories: 5 })
})

describe('PodcastStoriesTab', () => {
  it('starts an interactive episode at once', async () => {
    renderInAdmin(<PodcastStoriesTab podcast={makePodcast({ stage: 'created', mode: null, awaitingReview: false })} pendingEdits={false} onDirtyChange={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Interactive (review each step)' }))
    await waitFor(() => expect(mockApi.resume).toHaveBeenCalledWith('pod-1', 'interactive'))
  })

  it('asks for the typical cost before a fully automated start, and sends nothing on cancel', async () => {
    renderInAdmin(<PodcastStoriesTab podcast={makePodcast({ stage: 'created', mode: null, awaitingReview: false, ttsCharsEstimate: null })} pendingEdits={false} onDirtyChange={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fully automated' }))
    expect(await screen.findByText(/10,800 of 32,000/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockApi.resume).not.toHaveBeenCalled()
  })

  it('approves the stories, unless the picker holds unsaved edits', async () => {
    const { unmount } = renderInAdmin(<PodcastStoriesTab podcast={makePodcast({ stage: 'selected' })} pendingEdits onDirtyChange={noop} />)
    expect((await screen.findByRole('button', { name: 'Approve stories and write the script' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    renderInAdmin(<PodcastStoriesTab podcast={makePodcast({ stage: 'selected' })} pendingEdits={false} onDirtyChange={noop} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve stories and write the script' }))
    await waitFor(() => expect(mockApi.resume).toHaveBeenCalledWith('pod-1', undefined))
  })

  it('starts over only after the confirmation', async () => {
    renderInAdmin(<PodcastStoriesTab podcast={makePodcast()} pendingEdits={false} onDirtyChange={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(mockApi.rewind).not.toHaveBeenCalled()
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start over' }))
    await waitFor(() => expect(mockApi.rewind).toHaveBeenCalledWith('pod-1', 'created', true))
  })

  it('goes back to the stories from the script without starting a run', async () => {
    mockApi.rewind.mockResolvedValue(makePodcast({ stage: 'selected' }))
    renderInAdmin(<PodcastStoriesTab podcast={makePodcast()} pendingEdits={false} onDirtyChange={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change stories' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change stories' }))
    await waitFor(() => expect(mockApi.rewind).toHaveBeenCalledWith('pod-1', 'selected', false))
  })
})
