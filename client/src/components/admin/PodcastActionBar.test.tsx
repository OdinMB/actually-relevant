import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ usage: vi.fn(), active: vi.fn(), delete: vi.fn(), resume: vi.fn(), publish: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastActionBar, deleteBlockedReason } from './PodcastActionBar'

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}</output>
}

const ready = makePodcast({ stage: 'ready', awaitingReview: false, audioUrl: 'https://audio.example/e.mp3', durationSec: 342 })
const published = { ...ready, status: 'published' as const, publishedAt: '2026-10-12T07:00:00.000Z' }
const describedBy = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 0, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 })
  mockApi.active.mockResolvedValue([])
  mockApi.delete.mockResolvedValue(undefined)
  mockApi.resume.mockResolvedValue(makePodcast({ inProgress: true }))
})

describe('deleteBlockedReason', () => {
  it('refuses while a run works and once ever published, like the server', () => {
    expect(deleteBlockedReason(ready)).toBeNull()
    expect(deleteBlockedReason({ ...ready, inProgress: true })).not.toBeNull()
    expect(deleteBlockedReason(published)).not.toBeNull()
    expect(deleteBlockedReason({ ...ready, status: 'draft', publishedAt: '2026-10-12T07:00:00.000Z' })).not.toBeNull()
  })

  it('lets a published legacy row be deleted', () => {
    expect(deleteBlockedReason(makePodcast({ stage: 'legacy', status: 'published', publishedAt: '2026-01-01T00:00:00.000Z' }))).toBeNull()
  })
})

describe('PodcastActionBar', () => {
  it('plays an episode with audio from its CDN URL, without preloading', () => {
    const { container } = renderInAdmin(<PodcastActionBar podcast={ready} pendingEdits={false} />)
    const audio = container.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('https://audio.example/e.mp3')
    expect(audio?.getAttribute('preload')).toBe('none')
  })

  it('shows no player before there is audio', () => {
    const { container } = renderInAdmin(<PodcastActionBar podcast={makePodcast()} pendingEdits={false} />)
    expect(container.querySelector('audio')).toBeNull()
  })

  it('deletes only after the confirmation, then returns to the list', async () => {
    renderInAdmin(<><PodcastActionBar podcast={ready} pendingEdits={false} /><Where /></>, { route: '/admin/podcasts/pod-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mockApi.delete).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('pod-1'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/podcasts'))
  })

  it('keeps Delete inert, with its reason, on a published episode', () => {
    renderInAdmin(<PodcastActionBar podcast={published} pendingEdits={false} />)
    const del = screen.getByRole('button', { name: 'Delete' })
    expect(del.getAttribute('aria-disabled')).toBe('true')
    expect(describedBy(del)?.textContent).toBe(deleteBlockedReason(published))
    fireEvent.click(del)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers Resume after a failure, asking for the cost when it will voice', async () => {
    renderInAdmin(<PodcastActionBar podcast={makePodcast({ awaitingReview: false, lastError: 'tts down' })} pendingEdits={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(mockApi.resume).not.toHaveBeenCalled()
  })

  it('asks before finishing automatically, then runs in automated mode', async () => {
    renderInAdmin(<PodcastActionBar podcast={makePodcast({ stage: 'selected', ttsCharsEstimate: null })} pendingEdits={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Finish automatically' }))
    const dialog = await screen.findByRole('dialog')
    expect(mockApi.resume).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Write and voice it' }))
    await waitFor(() => expect(mockApi.resume).toHaveBeenCalledWith('pod-1', 'automated'))
  })

  it('keeps Finish automatically disabled while the page holds unsaved edits', () => {
    renderInAdmin(<PodcastActionBar podcast={makePodcast({ stage: 'selected' })} pendingEdits />)
    expect((screen.getByRole('button', { name: 'Finish automatically' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps Resume disabled while the page holds unsaved edits, saying why', () => {
    renderInAdmin(<PodcastActionBar podcast={makePodcast({ stage: 'selected', awaitingReview: false, lastError: 'too few stories' })} pendingEdits />)
    const resume = screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement
    expect(resume.disabled).toBe(true)
    expect(describedBy(resume)).not.toBeNull()
    fireEvent.click(resume)
    expect(mockApi.resume).not.toHaveBeenCalled()
  })

  it('offers neither Resume nor Finish automatically while a run works', () => {
    renderInAdmin(<PodcastActionBar podcast={makePodcast({ stage: 'selected', inProgress: true, awaitingReview: false })} pendingEdits={false} />)
    expect(screen.queryByRole('button', { name: /Resume|Finish automatically/ })).toBeNull()
  })
})
