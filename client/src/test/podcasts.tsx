import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Podcast, PodcastDialogue } from '@shared/types'
import { ToastProvider } from '../components/ui/Toast'
import { PodcastProgressProvider } from '../hooks/usePodcastProgress'

/** Render inside what the admin layout provides: queries, router (at `route`), toasts and podcast progress. */
export function renderInAdmin(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <PodcastProgressProvider>{ui}</PodcastProgressProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A short two-story dialogue: an intro, two stories and an outro. */
export function makeDialogue(): PodcastDialogue {
  return {
    episodeTitle: 'Clean air and vaccines',
    episodeSummary: 'Two stories from this week.',
    segments: [
      { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_A', text: 'Welcome to the week.' }] },
      { kind: 'story', storyRef: 1, turns: [{ speaker: 'HOST_B', text: 'A court in Nairobi ruled on air data.' }, { speaker: 'HOST_A', text: 'It matters for millions.' }] },
      { kind: 'story', storyRef: 2, turns: [{ speaker: 'HOST_A', text: 'From air to health: vaccines.' }, { speaker: 'HOST_B', text: 'Ten more countries.' }] },
      { kind: 'outro', storyRef: null, turns: [{ speaker: 'HOST_B', text: 'That was the week.' }] },
    ],
  }
}

/**
 * A scripted, interactive episode at rest; override what a test needs. Unless overridden,
 * `publishBlockedReason` follows the server's rule roughly: null only for a ready, non-dry-run draft at rest.
 */
export function makePodcast(overrides: Partial<Podcast> = {}): Podcast {
  const podcast = baseEpisode(overrides)
  const publishable = podcast.status === 'published' || (podcast.stage === 'ready' && !podcast.inProgress && !podcast.dryRun)
  return { publishBlockedReason: publishable ? null : `not publishable at ${podcast.stage}`, ...podcast }
}

function baseEpisode(overrides: Partial<Podcast>): Omit<Podcast, 'publishBlockedReason'> & Partial<Pick<Podcast, 'publishBlockedReason'>> {
  return {
    id: 'pod-1',
    title: 'W41: Clean air and vaccines',
    status: 'draft',
    stage: 'scripted',
    mode: 'interactive',
    weekKey: '2026-W41',
    storyIds: ['s1', 's2'],
    attempts: 0,
    blockedAt: null,
    blockedReason: null,
    lastError: null,
    failedAt: null,
    dryRun: false,
    inProgress: false,
    awaitingReview: true,
    activity: null,
    humanEdited: false,
    script: 'HOST A: Hello.',
    dialogue: makeDialogue(),
    episodeSummary: 'Two stories from this week.',
    showNotes: 'AI-generated: notes',
    episodeStories: [
      { ref: 1, id: 's1', title: 'Air data ruling', publisher: 'Nation', sourceUrl: 'https://x.example/1', slug: 'air', issue: 'Planet' },
      { ref: 2, id: 's2', title: 'Vaccine rollout', publisher: 'Phys.org', sourceUrl: 'https://x.example/2', slug: 'vax', issue: 'Health' },
    ],
    ttsModelId: null,
    audioUrl: null,
    transcriptUrl: null,
    audioBytes: null,
    durationSec: null,
    readyAt: null,
    publishedAt: null,
    unpublishedAt: null,
    ttsChars: 0,
    ttsCharsEstimate: 5400,
    createdAt: '2026-10-10T06:00:00.000Z',
    updatedAt: '2026-10-10T06:00:00.000Z',
    ...overrides,
  }
}
