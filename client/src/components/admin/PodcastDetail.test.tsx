import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({
  usage: vi.fn(),
  active: vi.fn(),
  update: vi.fn(),
  storyPool: vi.fn(),
}))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastDetail, canEditTitle } from './PodcastDetail'
import { podcastRefetchInterval, PODCAST_POLL_MS } from '../../hooks/usePodcasts'

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 10800, monthlyCap: 32000 })
  mockApi.active.mockResolvedValue([])
  mockApi.storyPool.mockResolvedValue({ stories: [], minStories: 4, maxStories: 5 })
})

describe('canEditTitle', () => {
  it('allows a title edit once there is a script, at rest, before publication', () => {
    expect(canEditTitle(makePodcast())).toBe(true)
    expect(canEditTitle(makePodcast({ stage: 'ready' }))).toBe(true)
    expect(canEditTitle(makePodcast({ stage: 'selected' }))).toBe(false)
    expect(canEditTitle(makePodcast({ inProgress: true }))).toBe(false)
    expect(canEditTitle(makePodcast({ stage: 'ready', status: 'published' }))).toBe(false)
  })
})

describe('podcastRefetchInterval', () => {
  it('polls only while the episode is in progress', () => {
    expect(podcastRefetchInterval(makePodcast({ inProgress: true }))).toBe(PODCAST_POLL_MS)
    expect(podcastRefetchInterval(makePodcast())).toBe(false)
    expect(podcastRefetchInterval(undefined)).toBe(false)
  })
})

describe('PodcastDetail', () => {
  it('shows a blocked episode\'s reason with a Resume button', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ awaitingReview: false, blockedAt: '2026-10-10T07:00:00.000Z', blockedReason: 'the dialogue is still invalid' })} />)
    expect(screen.getByRole('alert').textContent).toContain('the dialogue is still invalid')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('opens the script editor for a scripted episode at rest', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    expect(screen.getByLabelText('Episode summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve script and voice it' })).toBeTruthy()
  })

  it('shows the script read-only while a run works on the episode', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'voiced', inProgress: true, awaitingReview: false, activity: 'Assembling and uploading' })} />)
    expect(screen.getByText('HOST A: Hello.')).toBeTruthy()
    expect(screen.queryByLabelText('Episode summary')).toBeNull()
  })

  it('plays a ready episode from its CDN URL, shows the characters billed and the next steps', async () => {
    const audioUrl = 'https://audio.actuallyrelevant.news/episodes/2026-W41-abcd1234.mp3'
    const { container } = renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'ready', awaitingReview: false, audioUrl, durationSec: 342, ttsChars: 5400 })} />)
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe(audioUrl)
    expect(audio?.getAttribute('preload')).toBe('none')
    expect(screen.getByText('Duration 5:42')).toBeTruthy()
    expect(screen.getByText('5,400')).toBeTruthy()
    expect(await screen.findByText('10,800 of 32,000')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerate audio' })).toBeTruthy()
  })

  it('offers no audio changes on a published episode', () => {
    renderInAdmin(<PodcastDetail podcast={makePodcast({ stage: 'ready', status: 'published', awaitingReview: false })} />)
    expect(screen.queryByRole('button', { name: 'Regenerate audio' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
  })

  it('sends the "edited by a person" flag when the box is changed', async () => {
    mockApi.update.mockResolvedValue(makePodcast({ humanEdited: true }))
    renderInAdmin(<PodcastDetail podcast={makePodcast()} />)
    fireEvent.click(screen.getByLabelText('Edited by a person'))
    await waitFor(() => expect(mockApi.update).toHaveBeenCalledWith('pod-1', { humanEdited: true }))
  })
})
