import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Podcast } from '@shared/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ReasonButton } from '../ui/ReasonButton'
import { useToast } from '../ui/Toast'
import { useDeletePodcast } from '../../hooks/usePodcasts'
import { LEAVE_UNSAVED } from '../../hooks/useUnsavedChangesGuard'
import { PodcastPublishControls } from './PodcastPublishControls'
import { PodcastRunButton } from './PodcastRunButton'
import { nextAction } from './podcastRun'
import { wasPublished } from './podcastPublished'
import { STICKY_ACTION_BAR } from './stickyActionBar'

/** Why the episode cannot be deleted now, or null (the server refuses the same: 409). A published legacy row stays deletable. */
export function deleteBlockedReason(podcast: Podcast): string | null {
  if (podcast.inProgress) return 'A run is working on the episode; it can be deleted once the run finishes.'
  if (wasPublished(podcast)) return 'An episode that was published is never deleted, so podcast apps keep a stable entry. Unpublish takes it out of the feed.'
  return null
}

interface PodcastActionBarProps {
  podcast: Podcast
  /** The open tab holds unsaved edits: continuing would lose them. */
  pendingEdits: boolean
}

/**
 * The bar fixed to the bottom of the admin content area: Resume or Finish automatically where they
 * apply, Publish (disabled with its reason) or Unpublish, Delete behind a confirmation, and a
 * compact player once the episode has audio. It sits below the toasts (z-10 against z-50).
 */
export function PodcastActionBar({ podcast, pendingEdits }: PodcastActionBarProps) {
  const del = useDeletePodcast()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hintId = useId()
  const action = nextAction(podcast)
  const legacy = podcast.stage === 'legacy'
  const writesFirst = podcast.stage !== 'scripted'

  const handleDelete = () =>
    del.mutate(podcast.id, {
      onSuccess: () => {
        toast('success', 'Podcast deleted')
        // The episode is gone, and its unsaved edits with it: leave without the page's guard asking.
        navigate('/admin/podcasts', { state: LEAVE_UNSAVED })
      },
      onError: err => toast('error', err instanceof Error ? err.message : 'Failed to delete'),
      onSettled: () => setConfirmDelete(false),
    })

  return (
    <div role="region" aria-label="Episode actions" className={STICKY_ACTION_BAR}>
      <div className="flex min-h-[2.5rem] flex-wrap items-center gap-x-3 gap-y-2">
        {action === 'resume' && (
          <PodcastRunButton
            podcast={podcast}
            confirmTitle={writesFirst ? 'Resume, then write and voice the episode?' : 'Resume and voice the episode?'}
            disabled={pendingEdits}
            aria-describedby={pendingEdits ? hintId : undefined}
          >
            Resume
          </PodcastRunButton>
        )}
        {action === 'approve-stories' && (
          <PodcastRunButton
            podcast={podcast}
            mode="automated"
            variant="secondary"
            confirmTitle="Write the script and voice it without review?"
            disabled={pendingEdits}
            aria-describedby={pendingEdits ? hintId : undefined}
          >
            Finish automatically
          </PodcastRunButton>
        )}
        {pendingEdits && (action === 'resume' || action === 'approve-stories') && (
          <span id={hintId} className="text-sm text-neutral-600">
            Save or discard your changes first.
          </span>
        )}
        {!legacy && <PodcastPublishControls podcast={podcast} />}
        <ReasonButton
          variant="ghost"
          reason={deleteBlockedReason(podcast)}
          onClick={() => setConfirmDelete(true)}
          className="text-red-700 hover:bg-red-50 hover:text-red-800"
        >
          Delete
        </ReasonButton>
        {podcast.audioUrl && (
          <audio controls preload="none" src={podcast.audioUrl} aria-label={`Episode audio: ${podcast.title}`} className="h-9 w-full sm:ml-auto sm:w-80" />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this episode?"
        description="This permanently removes the episode, its script and its audio. It cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        loading={del.isPending}
      />
    </div>
  )
}
