import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ usage: vi.fn(), active: vi.fn(), rewind: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastAudioTab } from './PodcastAudioTab'

const ready = makePodcast({ stage: 'ready', awaitingReview: false, audioUrl: 'https://audio.example/e.mp3', durationSec: 342, ttsChars: 5400 })

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 10800, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
  mockApi.active.mockResolvedValue([])
  mockApi.rewind.mockResolvedValue(makePodcast({ stage: 'scripted' }))
})

describe('PodcastAudioTab', () => {
  it('shows the duration, the characters billed and the month against the cap', async () => {
    renderInAdmin(<PodcastAudioTab podcast={ready} onBackToScript={() => {}} />)
    expect(screen.getByText(/Duration 5:42/)).toBeTruthy()
    expect(screen.getByText('5,400')).toBeTruthy()
    expect(await screen.findByText('10,800 of 32,000')).toBeTruthy()
  })

  it('asks for the cost before regenerating the audio', async () => {
    renderInAdmin(<PodcastAudioTab podcast={ready} onBackToScript={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate audio' }))
    const dialog = await screen.findByRole('dialog')
    expect(mockApi.rewind).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regenerate audio' }))
    await waitFor(() => expect(mockApi.rewind).toHaveBeenCalledWith('pod-1', 'scripted', true))
  })

  it('goes back to the script without voicing, then shows the Script tab', async () => {
    const onBackToScript = vi.fn()
    renderInAdmin(<PodcastAudioTab podcast={ready} onBackToScript={onBackToScript} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to script' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Back to script' }))
    await waitFor(() => expect(mockApi.rewind).toHaveBeenCalledWith('pod-1', 'scripted', false))
    await waitFor(() => expect(onBackToScript).toHaveBeenCalled())
  })

  it('offers no changes on an episode that was ever published', () => {
    renderInAdmin(<PodcastAudioTab podcast={{ ...ready, status: 'published', publishedAt: '2026-10-12T07:00:00.000Z' }} onBackToScript={() => {}} />)
    expect(screen.queryByRole('button', { name: /Regenerate audio|Back to script/ })).toBeNull()
  })
})
