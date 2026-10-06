import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({
  usage: vi.fn(),
  active: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastPublishControls, publishOption } from './PodcastPublishControls'
import { PodcastDetail } from './PodcastDetail'

const ready = makePodcast({ stage: 'ready', awaitingReview: false, audioUrl: 'https://audio.example/e.mp3' })

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 0, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
  mockApi.active.mockResolvedValue([])
})

describe('publishOption', () => {
  it('offers publication only when the server gives no reason against it', () => {
    expect(publishOption(ready)).toBe('publish')
    expect(publishOption({ ...ready, publishBlockedReason: 'the episode has no uploaded audio' })).toBe('blocked')
  })

  it('offers unpublish while listed, and publish again after a takedown', () => {
    expect(publishOption({ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' })).toBe('unpublish')
    expect(publishOption({ ...ready, status: 'draft', publishedAt: '2026-10-12T07:00:00.000Z' })).toBe('republish')
  })
})

describe('PodcastDetail publishing', () => {
  it('offers an enabled Publish for an episode generated before review modes and publishing existed', () => {
    // The production episode of 2026-10-06: automated mode, never edited, a ready draft with audio.
    const phase2 = makePodcast({
      stage: 'ready', mode: 'automated', awaitingReview: false, humanEdited: false, status: 'draft',
      audioUrl: 'https://audio.example/e.mp3', audioBytes: 5_000_000, readyAt: '2026-10-06T10:00:00.000Z',
      publishedAt: null, unpublishedAt: null, publishBlockedReason: null,
    })
    renderInAdmin(<PodcastDetail podcast={phase2} />)
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the reason in place of Publish while a run works on the episode', () => {
    const running = makePodcast({ stage: 'ready', inProgress: true, awaitingReview: false, publishBlockedReason: 'a run is working on the episode; publishing waits until it finishes' })
    renderInAdmin(<PodcastDetail podcast={running} />)
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.getByText(/a run is working on the episode/)).toBeTruthy()
  })

  it('shows the reason in place of Publish before the episode is ready', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'scripted', publishBlockedReason: 'only a ready episode can be published; this one is at scripted' })} />)
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.getByText(/this one is at scripted/)).toBeTruthy()
  })
})

describe('PodcastPublishControls', () => {
  it('publishes only after the confirmation', async () => {
    mockApi.publish.mockResolvedValue({ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' })
    renderInAdmin(<PodcastPublishControls podcast={ready} />)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(mockApi.publish).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Publish')!)
    await waitFor(() => expect(mockApi.publish).toHaveBeenCalledWith('pod-1'))
  })

  it('sends nothing when the confirmation is cancelled', async () => {
    renderInAdmin(<PodcastPublishControls podcast={{ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(mockApi.unpublish).not.toHaveBeenCalled()
  })

  it('unpublishes a listed episode after the confirmation', async () => {
    mockApi.unpublish.mockResolvedValue({ ...ready, status: 'draft', publishedAt: '2026-10-12T07:00:00.000Z' })
    renderInAdmin(<PodcastPublishControls podcast={{ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Unpublish')!)
    await waitFor(() => expect(mockApi.unpublish).toHaveBeenCalledWith('pod-1'))
  })
})

describe('PodcastDetail after publication', () => {
  it('offers no audio or script changes on an episode that was published and taken down', () => {
    renderInAdmin(<PodcastDetail podcast={{ ...ready, status: 'draft', publishedAt: '2026-10-12T07:00:00.000Z' }} />)
    expect(screen.queryByRole('button', { name: 'Regenerate audio' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit title' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Publish again' })).toBeTruthy()
  })

  it('keeps the "edited by a person" flag changeable on a published episode', () => {
    renderInAdmin(<PodcastDetail podcast={{ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' }} />)
    expect((screen.getByLabelText('Edited by a person') as HTMLInputElement).disabled).toBe(false)
  })
})
