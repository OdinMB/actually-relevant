import { useState } from 'react'
import type { Podcast } from '@shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { usePublishPodcast } from '../../hooks/usePodcasts'
import { formatDate } from '../../lib/constants'

export type PublishOption = 'publish' | 'republish' | 'unpublish' | 'blocked'

/**
 * What a person can do about publication now. A listed episode can always be unpublished; otherwise
 * the server's `publishBlockedReason` decides, so the page never guesses differently from the server.
 */
export function publishOption(podcast: Pick<Podcast, 'status' | 'publishedAt' | 'publishBlockedReason'>): PublishOption {
  if (podcast.status === 'published') return 'unpublish'
  if (podcast.publishBlockedReason) return 'blocked'
  return podcast.publishedAt ? 'republish' : 'publish'
}

const CONFIRM: Record<Exclude<PublishOption, 'blocked'>,{ button: string; title: string; description: string; danger?: boolean }> = {
  publish: {
    button: 'Publish',
    title: 'Publish this episode?',
    description:
      'It appears in the podcast feed, where podcast apps pick it up, and on the public podcast page. ' +
      'After that its audio, script and stories are fixed: it can no longer be regenerated, edited or deleted, only unpublished.',
  },
  republish: {
    button: 'Publish again',
    title: 'Publish this episode again?',
    description: 'It returns to the podcast feed and the podcast page with its original publication date.',
  },
  unpublish: {
    button: 'Unpublish',
    title: 'Unpublish this episode?',
    description:
      'It leaves the podcast feed and the podcast page. Podcast apps that already downloaded it keep their copy, ' +
      'and the MP3 stays on the CDN at its address until someone purges it in Bunny by hand.',
    danger: true,
  },
}

/**
 * Publish, publish again or unpublish an episode, each behind a confirmation; where publishing is not
 * possible, the reason in place of the button.
 */
export function PodcastPublishControls({ podcast }: { podcast: Podcast }) {
  const publish = usePublishPodcast()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const option = publishOption(podcast)

  if (option === 'blocked') {
    return <p className="text-sm text-neutral-700">Publishing is not possible now: {podcast.publishBlockedReason}.</p>
  }

  const copy = CONFIRM[option]
  const handleConfirm = () => publish.mutate({ id: podcast.id, publish: option !== 'unpublish' }, {
    onSuccess: () => toast('success', option === 'unpublish' ? 'Episode unpublished' : 'Episode published'),
    onError: err => toast('error', err instanceof Error ? err.message : 'Failed'),
    onSettled: () => setOpen(false),
  })

  return (
    <div className="space-y-2">
      {podcast.status === 'published' && podcast.publishedAt && (
        <p className="text-sm text-neutral-800">Published on {formatDate(podcast.publishedAt)}. It is in the podcast feed and on the podcast page.</p>
      )}
      <Button size="sm" variant={copy.danger ? 'secondary' : 'primary'} onClick={() => setOpen(true)} disabled={publish.isPending}>
        {copy.button}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.button}
        variant={copy.danger ? 'danger' : 'primary'}
        loading={publish.isPending}
      />
    </div>
  )
}
