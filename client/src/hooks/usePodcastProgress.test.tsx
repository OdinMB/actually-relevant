import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ActivePodcastRun } from '@shared/types'
import { makePodcast, renderInAdmin } from '../test/podcasts'

const mockApi = vi.hoisted(() => ({ active: vi.fn(), get: vi.fn() }))
vi.mock('../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { usePodcastProgress, progressMessage, runOutcome } from './usePodcastProgress'

const run = (overrides: Partial<ActivePodcastRun> = {}): ActivePodcastRun => ({
  id: 'pod-1', title: 'W41: Clean air', stage: 'scripted', mode: 'interactive', activity: 'Voicing', chunksDone: 2, chunksTotal: 5, ...overrides,
})

function Tracker() {
  const { track } = usePodcastProgress()
  return <button onClick={() => track('pod-1')}>track</button>
}

/** The provider re-reads the running episodes on window focus (and on its timer). */
const refocus = () => act(() => { window.dispatchEvent(new Event('focus')) })

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.active.mockResolvedValue([])
})

describe('progressMessage and runOutcome', () => {
  it('name the step and, while voicing, the chunks', () => {
    expect(progressMessage(run())).toBe('W41: Clean air: Voicing 2/5')
    expect(progressMessage(run({ stage: 'created', activity: 'Selecting stories', chunksDone: null, chunksTotal: null }))).toBe('W41: Clean air: Selecting stories')
  })

  it('turn a review stop or ready into a success, and a failure or block into a sticky error', () => {
    expect(runOutcome(makePodcast({ stage: 'selected' }))).toMatchObject({ type: 'success', sticky: false, message: expect.stringMatching(/review them/) })
    expect(runOutcome(makePodcast({ stage: 'ready' }))).toMatchObject({ type: 'success', message: expect.stringMatching(/ready to listen/) })
    expect(runOutcome(makePodcast({ lastError: 'model down' }))).toMatchObject({ type: 'error', sticky: true, message: expect.stringMatching(/model down/) })
    expect(runOutcome(makePodcast({ blockedAt: '2026-10-10T07:00:00Z', blockedReason: 'cap reached' }))).toMatchObject({ type: 'error', sticky: true, message: expect.stringMatching(/cap reached/) })
  })
})

describe('PodcastProgressProvider', () => {
  it('reattaches to a run the server reports on mount, with a toast linking to the episode', async () => {
    mockApi.active.mockResolvedValue([run()])
    renderInAdmin(<div />)
    const link = await screen.findByRole('link', { name: 'W41: Clean air: Voicing 2/5' })
    expect(link.getAttribute('href')).toBe('/admin/podcasts/pod-1')
  })

  it('keeps the progress toast while the run lasts, then turns it into the outcome', async () => {
    renderInAdmin(<Tracker />)
    await waitFor(() => expect(mockApi.active).toHaveBeenCalled())
    mockApi.active.mockResolvedValue([run()])
    fireEvent.click(screen.getByText('track'))
    expect(await screen.findByText('W41: Clean air: Voicing 2/5')).toBeTruthy()

    mockApi.active.mockResolvedValue([run({ chunksDone: 4 })])
    refocus()
    expect(await screen.findByText('W41: Clean air: Voicing 4/5')).toBeTruthy()

    mockApi.active.mockResolvedValue([])
    mockApi.get.mockResolvedValue(makePodcast({ stage: 'ready', title: 'W41: Clean air' }))
    refocus()
    const outcome = await screen.findByRole('link', { name: 'W41: Clean air: Episode ready to listen' })
    expect(outcome.getAttribute('href')).toBe('/admin/podcasts/pod-1')
    expect(mockApi.get).toHaveBeenCalledWith('pod-1')
  })

  it('reports a run that ended before the first poll by its outcome', async () => {
    renderInAdmin(<Tracker />)
    await waitFor(() => expect(mockApi.active).toHaveBeenCalled())
    mockApi.get.mockResolvedValue(makePodcast({ title: 'W41: Clean air', lastError: 'model down' }))
    fireEvent.click(screen.getByText('track'))
    expect(await screen.findByText(/W41: Clean air: failed\. model down/)).toBeTruthy()
  })
})
