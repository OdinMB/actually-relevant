import { useState, type ReactElement } from 'react'
import type { Podcast } from '@shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useRewindPodcast } from '../../hooks/usePodcasts'
import { PodcastRunButton } from './PodcastRunButton'
import { PodcastStoryFinder } from './PodcastStoryFinder'
import { PodcastStoryPicker } from './PodcastStoryPicker'
import { atRestAndChangeable, nextAction } from './podcastRun'

function EpisodeStoriesList({ podcast }: { podcast: Podcast }) {
  if (!podcast.episodeStories || podcast.episodeStories.length === 0) {
    return (
      <p className="text-sm italic text-neutral-500">
        {podcast.inProgress ? 'The stories are being selected.' : 'No stories selected yet.'}
      </p>
    )
  }
  return (
    <section aria-labelledby="podcast-stories-heading" className="bg-white rounded-lg border border-neutral-200 p-4">
      <h2 id="podcast-stories-heading" className="text-sm font-semibold text-neutral-900 mb-3">Stories in this episode</h2>
      <ol className="list-decimal pl-5 space-y-1 text-sm text-neutral-700">
        {podcast.episodeStories.map(s => (
          <li key={s.ref}>
            {s.title} <span className="text-neutral-500">({s.publisher}, {s.issue})</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ModeChoice({ podcast }: { podcast: Podcast }) {
  return (
    <section aria-labelledby="podcast-mode-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3">
      <h2 id="podcast-mode-heading" className="text-sm font-semibold text-neutral-900">How should this episode be made?</h2>
      <div className="flex flex-wrap gap-2">
        <PodcastRunButton podcast={podcast} mode="interactive">Interactive (review each step)</PodcastRunButton>
        <PodcastRunButton podcast={podcast} mode="automated" variant="secondary" confirmTitle="Write and voice the whole episode?">Fully automated</PodcastRunButton>
      </div>
      <p className="text-xs text-neutral-600">
        Interactive stops after the stories are chosen and after the script is written, so you can change them. Fully automated selects, writes, voices and assembles in one go.
      </p>
    </section>
  )
}

type Rewind = 'start-over' | 'start-over-standalone' | 'change-stories'

const REWIND: Record<Rewind, { title: string; description: string; label: string }> = {
  'start-over': {
    title: 'Start this episode over?',
    description: 'The stories, script and audio are discarded and new stories are selected. The episode then waits for your review.',
    label: 'Start over',
  },
  'start-over-standalone': {
    title: 'Start this episode over?',
    description: 'The stories, script and audio are discarded. Choose the stories again.',
    label: 'Start over',
  },
  'change-stories': {
    title: 'Go back to the stories?',
    description: 'This script and your edits are discarded. After you change the stories, approving them writes a new script.',
    label: 'Change stories',
  },
}

interface PodcastStoriesTabProps {
  podcast: Podcast
  pendingEdits: boolean
  onDirtyChange: (dirty: boolean) => void
}

/** Where each rewind goes; only a weekly Start over continues at once (the model selects new stories). */
const REWIND_TARGET: Record<Rewind, { to: 'created' | 'selected'; advance: boolean }> = {
  'start-over': { to: 'created', advance: true },
  'start-over-standalone': { to: 'created', advance: false },
  'change-stories': { to: 'selected', advance: false },
}

/** The story editor for the episode at rest, or null: the finder for a standalone episode, the week's pool picker for a weekly one. */
function storyEditor(podcast: Podcast, onDirtyChange: (dirty: boolean) => void): ReactElement | null {
  const standalone = podcast.kind === 'standalone'
  const editable = atRestAndChangeable(podcast) && (podcast.stage === 'selected' || (standalone && podcast.stage === 'created'))
  if (!editable) return null
  return standalone
    ? <PodcastStoryFinder podcast={podcast} onDirtyChange={onDirtyChange} />
    : <PodcastStoryPicker podcast={podcast} onDirtyChange={onDirtyChange} />
}

/**
 * The Stories stage as a form: the mode choice for a new weekly episode, the story finder for a new
 * standalone one; at `selected`, the picker or finder (Save selection) and the approval that writes
 * the script; later, the chosen stories read-only with Change stories (at `scripted`) and Start over.
 */
export function PodcastStoriesTab({ podcast, pendingEdits, onDirtyChange }: PodcastStoriesTabProps) {
  const rewind = useRewindPodcast()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<Rewind | null>(null)
  const action = nextAction(podcast)
  const changeable = atRestAndChangeable(podcast)

  if (action === 'choose-mode') return <ModeChoice podcast={podcast} />

  const handleRewind = () => {
    if (!confirm) return
    rewind.mutate({ id: podcast.id, ...REWIND_TARGET[confirm] }, {
      onError: err => toast('error', err instanceof Error ? err.message : 'Failed'),
      onSettled: () => setConfirm(null),
    })
  }
  const startOver: Rewind = podcast.kind === 'standalone' ? 'start-over-standalone' : 'start-over'

  return (
    <div className="space-y-4">
      {storyEditor(podcast, onDirtyChange) ?? <EpisodeStoriesList podcast={podcast} />}

      <div className="flex flex-wrap items-center gap-2">
        {action === 'approve-stories' && (
          <PodcastRunButton podcast={podcast} disabled={pendingEdits}>Approve stories and write the script</PodcastRunButton>
        )}
        {podcast.stage === 'scripted' && changeable && (
          <Button variant="secondary" size="sm" onClick={() => setConfirm('change-stories')} disabled={rewind.isPending}>Change stories</Button>
        )}
        {changeable && podcast.stage !== 'created' && (
          <Button variant="ghost" size="sm" onClick={() => setConfirm(startOver)} disabled={rewind.isPending}>Start over</Button>
        )}
      </div>
      {action === 'approve-stories' && (
        <p className="min-h-[1rem] text-xs text-neutral-600">{pendingEdits ? 'Save or discard your changes first.' : ''}</p>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={handleRewind}
        title={confirm ? REWIND[confirm].title : ''}
        description={confirm ? REWIND[confirm].description : undefined}
        variant="danger"
        confirmLabel={confirm ? REWIND[confirm].label : undefined}
        loading={rewind.isPending}
      />
    </div>
  )
}
