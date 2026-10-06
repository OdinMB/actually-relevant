import { useState } from 'react'
import type { Podcast } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useUpdatePodcast, useResumePodcast } from '../../hooks/usePodcasts'
import { useToast } from '../ui/Toast'
import { formatDate } from '../../lib/constants'
import { AssignedStoriesList } from './AssignedStoriesList'
import { PodcastStageBadge } from './PodcastStageBadge'

interface PodcastDetailProps {
  podcast: Podcast
}

/** Resume continues an episode that is waiting: blocked, failed, or not yet scripted. */
export function canResume(podcast: Podcast): boolean {
  if (podcast.stage === 'legacy' || podcast.inProgress) return false
  return podcast.blockedAt != null || podcast.lastError != null || podcast.stage === 'created'
}

function TextBlock({ title, text, empty }: { title: string; text: string; empty: string }) {
  return (
    <section className="bg-white rounded-lg border border-neutral-200 p-4">
      <h3 className="text-sm font-semibold text-neutral-900 mb-3">{title}</h3>
      <div className="text-sm text-neutral-700 whitespace-pre-wrap max-h-[32rem] overflow-y-auto">
        {text || <span className="text-neutral-500 italic">{empty}</span>}
      </div>
    </section>
  )
}

export function PodcastDetail({ podcast }: PodcastDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(podcast.title)
  const { toast } = useToast()

  const update = useUpdatePodcast()
  const resume = useResumePodcast()
  const legacy = podcast.stage === 'legacy'

  const handleSaveTitle = async () => {
    try {
      await update.mutateAsync({ id: podcast.id, data: { title } })
      toast('success', 'Title updated')
      setEditingTitle(false)
    } catch { toast('error', 'Failed to update title') }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {editingTitle ? (
          <div className="flex-1 flex gap-2">
            <Input id="pod-title" aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} className="flex-1" />
            <Button size="sm" onClick={handleSaveTitle} loading={update.isPending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditingTitle(false); setTitle(podcast.title) }}>Cancel</Button>
          </div>
        ) : (
          <>
            <PodcastStageBadge podcast={podcast} />
            <Badge variant={podcast.status === 'published' ? 'green' : 'gray'}>
              {podcast.status === 'published' ? 'Published' : 'Draft'}
            </Badge>
            {podcast.dryRun && <Badge variant="orange">Dry run</Badge>}
            {podcast.weekKey && <span className="text-sm text-neutral-600">{podcast.weekKey}</span>}
            <Button variant="ghost" size="sm" onClick={() => setEditingTitle(true)}>Edit title</Button>
          </>
        )}
      </div>

      {podcast.blockedAt && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Blocked since {formatDate(podcast.blockedAt)}</p>
          <p className="mt-1">{podcast.blockedReason}</p>
        </div>
      )}
      {!podcast.blockedAt && podcast.lastError && (
        <div role="status" className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          <p className="font-semibold">Last run failed{podcast.failedAt ? ` on ${formatDate(podcast.failedAt)}` : ''}</p>
          <p className="mt-1">{podcast.lastError}</p>
        </div>
      )}
      {podcast.attempts > 0 && (
        <p className="text-sm text-neutral-600">Automatic attempts this week: {podcast.attempts}</p>
      )}

      {canResume(podcast) && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => resume.mutate(podcast.id, {
            onSuccess: () => toast('success', 'Resumed: the script is being written'),
            onError: () => toast('error', 'Failed to resume'),
          })} loading={resume.isPending}>
            Resume
          </Button>
        </div>
      )}

      {legacy ? (
        <>
          <AssignedStoriesList label="Assigned stories" storyIds={podcast.storyIds} />
          <TextBlock title="Script (legacy, read-only)" text={podcast.script} empty="No script." />
        </>
      ) : (
        <>
          {podcast.episodeStories && podcast.episodeStories.length > 0 && (
            <section className="bg-white rounded-lg border border-neutral-200 p-4">
              <h3 className="text-sm font-semibold text-neutral-900 mb-3">Stories in this episode</h3>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-neutral-700">
                {podcast.episodeStories.map(s => (
                  <li key={s.ref}>
                    {s.title} <span className="text-neutral-500">({s.publisher}, {s.issue})</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <TextBlock title="Script" text={podcast.script} empty={podcast.inProgress ? 'The script is being written.' : 'No script yet.'} />
          <TextBlock title="Show notes" text={podcast.showNotes} empty="No show notes yet." />
        </>
      )}
    </div>
  )
}
