import { useState } from 'react'
import type { Podcast } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useUpdatePodcast } from '../../hooks/usePodcasts'
import { useToast } from '../ui/Toast'
import { formatDate } from '../../lib/constants'
import { AssignedStoriesList } from './AssignedStoriesList'
import { PodcastAudioSection } from './PodcastAudioSection'
import { PodcastScriptEditor } from './PodcastScriptEditor'
import { PodcastStageBadge } from './PodcastStageBadge'
import { PodcastStageStepper } from './PodcastStageStepper'
import { PodcastStoryPicker } from './PodcastStoryPicker'
import { wasPublished } from './podcastPublished'

interface PodcastDetailProps {
  podcast: Podcast
}

/** The title can be edited once the script exists (the script stage writes it), until publication. */
export function canEditTitle(podcast: Podcast): boolean {
  const scripted = podcast.stage === 'scripted' || podcast.stage === 'voiced' || podcast.stage === 'ready'
  return scripted && !podcast.inProgress && !wasPublished(podcast)
}

/** The read-only script once there is one, or while it is being written. */
const scriptBlockShown = (podcast: Podcast) =>
  podcast.stage !== 'created' && (podcast.stage !== 'selected' || podcast.inProgress)

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

function EpisodeStoriesList({ podcast }: { podcast: Podcast }) {
  if (!podcast.episodeStories || podcast.episodeStories.length === 0) return null
  return (
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
  )
}

/**
 * "Edited by a person": ticked by the server when a person changes the stories or the script; the
 * person can change it at any time, also after publication (it only picks the AI line).
 */
function HumanEditedToggle({ podcast }: { podcast: Podcast }) {
  const update = useUpdatePodcast()
  const { toast } = useToast()
  const disabled = podcast.inProgress || update.isPending
  return (
    <div className="flex items-start gap-2">
      <input
        id="podcast-human-edited"
        type="checkbox"
        checked={podcast.humanEdited}
        disabled={disabled}
        onChange={e => update.mutate({ id: podcast.id, data: { humanEdited: e.target.checked } }, {
          onError: err => toast('error', err instanceof Error ? err.message : 'Failed to update'),
        })}
        aria-describedby="podcast-human-edited-help"
        className="mt-0.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
      />
      <div>
        <label htmlFor="podcast-human-edited" className="text-sm font-medium text-neutral-800">Edited by a person</label>
        <p id="podcast-human-edited-help" className="text-xs text-neutral-600">
          Ticked automatically when someone changes the stories or the script. It chooses the AI line in the show notes and in the episode description in the podcast feed and on the podcast page.
        </p>
      </div>
    </div>
  )
}

/**
 * The episode page: header (stage, status, title), the "edited by a person" flag, problems, the
 * production steps, and below them the part for the stage: the story picker at `selected`, the
 * script editor at `scripted`, the audio and next steps at `ready`.
 */
export function PodcastDetail({ podcast }: PodcastDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(podcast.title)
  const [pendingEdits, setPendingEdits] = useState(false)
  const { toast } = useToast()
  const update = useUpdatePodcast()
  const legacy = podcast.stage === 'legacy'
  const atRest = !podcast.inProgress && !wasPublished(podcast)

  const handleSaveTitle = async () => {
    try {
      await update.mutateAsync({ id: podcast.id, data: { title } })
      toast('success', 'Title updated')
      setEditingTitle(false)
    } catch (err) { toast('error', err instanceof Error ? err.message : 'Failed to update title') }
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
              {podcast.status === 'published' ? 'Published' : podcast.publishedAt ? 'Unpublished' : 'Draft'}
            </Badge>
            {podcast.dryRun && <Badge variant="orange">Dry run</Badge>}
            {podcast.weekKey && <span className="text-sm text-neutral-600">{podcast.weekKey}</span>}
            {canEditTitle(podcast) && (
              <Button variant="ghost" size="sm" onClick={() => { setTitle(podcast.title); setEditingTitle(true) }}>Edit title</Button>
            )}
          </>
        )}
      </div>

      {!legacy && <HumanEditedToggle podcast={podcast} />}

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

      {legacy ? (
        <>
          <AssignedStoriesList label="Assigned stories" storyIds={podcast.storyIds} />
          <TextBlock title="Script (legacy, read-only)" text={podcast.script} empty="No script." />
        </>
      ) : (
        <>
          <PodcastStageStepper podcast={podcast} pendingEdits={pendingEdits} />
          {podcast.stage === 'selected' && atRest
            ? <PodcastStoryPicker podcast={podcast} onDirtyChange={setPendingEdits} />
            : <EpisodeStoriesList podcast={podcast} />}
          {podcast.stage === 'scripted' && atRest && podcast.dialogue
            ? <PodcastScriptEditor podcast={podcast} onDirtyChange={setPendingEdits} />
            : scriptBlockShown(podcast) && (
              <TextBlock title="Script" text={podcast.script} empty={podcast.inProgress ? 'The script is being written.' : 'No script yet.'} />
            )}
          <PodcastAudioSection podcast={podcast} />
          <TextBlock title="Show notes" text={podcast.showNotes} empty="No show notes yet." />
        </>
      )}
    </div>
  )
}
