import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Podcast } from '@shared/types'
import { ToastProvider } from '../ui/Toast'
import { PodcastDetail, canResume } from './PodcastDetail'
import { podcastRefetchInterval, PODCAST_POLL_MS } from '../../hooks/usePodcasts'

function makePodcast(overrides: Partial<Podcast> = {}): Podcast {
  return {
    id: 'pod-1',
    title: 'Clean air and vaccines',
    status: 'draft',
    stage: 'scripted',
    weekKey: '2026-W41',
    storyIds: ['s1'],
    attempts: 0,
    blockedAt: null,
    blockedReason: null,
    lastError: null,
    failedAt: null,
    dryRun: false,
    inProgress: false,
    script: 'HOST A: Hello.',
    episodeSummary: 'Summary.',
    showNotes: 'AI-generated: notes',
    episodeStories: [{ ref: 1, id: 's1', title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://x.example', slug: 'air', issue: 'Planet' }],
    createdAt: '2026-10-10T06:00:00.000Z',
    updatedAt: '2026-10-10T06:00:00.000Z',
    ...overrides,
  }
}

function renderDetail(podcast: Podcast) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PodcastDetail podcast={podcast} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('canResume', () => {
  it('offers Resume for a blocked, failed or unscripted episode', () => {
    expect(canResume(makePodcast({ blockedAt: '2026-10-10T07:00:00.000Z' }))).toBe(true)
    expect(canResume(makePodcast({ lastError: 'timeout' }))).toBe(true)
    expect(canResume(makePodcast({ stage: 'created' }))).toBe(true)
  })

  it('hides Resume while in progress, for legacy rows and for a scripted episode without trouble', () => {
    expect(canResume(makePodcast({ stage: 'created', inProgress: true }))).toBe(false)
    expect(canResume(makePodcast({ stage: 'legacy', lastError: 'x' }))).toBe(false)
    expect(canResume(makePodcast())).toBe(false)
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
    renderDetail(makePodcast({ blockedAt: '2026-10-10T07:00:00.000Z', blockedReason: 'the dialogue is still invalid' }))
    expect(screen.getByRole('alert').textContent).toContain('the dialogue is still invalid')
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('shows the episode\'s stories, script and show notes read-only', () => {
    renderDetail(makePodcast())
    expect(screen.getByText('Air data ruling')).toBeTruthy()
    expect(screen.getByText('HOST A: Hello.')).toBeTruthy()
    expect(screen.getByText('AI-generated: notes')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
  })
})
