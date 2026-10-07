import { useEffect, useRef, useState } from 'react'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import type { Podcast } from '@shared/types'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { useUpdatePodcast } from '../../hooks/usePodcasts'
import { wasPublished } from './podcastPublished'

/**
 * Why the title cannot be edited now, or null when it can: it exists once the script stage writes
 * it ("W41: …", edited as a whole), and is fixed while a run works and once ever published.
 */
export function titleEditBlockedReason(podcast: Podcast): string | null {
  if (wasPublished(podcast)) return 'A published episode keeps its title.'
  if (podcast.inProgress) return 'A run is working on the episode; edit the title when it finishes.'
  const scripted = podcast.stage === 'scripted' || podcast.stage === 'voiced' || podcast.stage === 'ready'
  if (!scripted) return 'The title is written with the script.'
  return null
}

/**
 * The episode title as the page heading, with a pencil after it that turns it into an inline field
 * (Enter saves, Escape cancels). Disabled, the pencil says why. A legacy episode shows only the title.
 */
export function PodcastTitle({ podcast }: { podcast: Podcast }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(podcast.title)
  const update = useUpdatePodcast()
  const { toast } = useToast()
  const blocked = titleEditBlockedReason(podcast)
  const pencil = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  // Leaving the field (Save, Cancel, Escape) puts keyboard focus back on the pencil.
  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    pencil.current?.focus()
  }, [editing])

  const stopEditing = () => { returnFocus.current = true; setEditing(false) }

  const save = async () => {
    try {
      await update.mutateAsync({ id: podcast.id, data: { title } })
      toast('success', 'Title updated')
      stopEditing()
    } catch (err) { toast('error', err instanceof Error ? err.message : 'Failed to update title') }
  }

  if (editing) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void save() }}>
        <label htmlFor="podcast-title" className="sr-only">Title</label>
        <input
          id="podcast-title"
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); stopEditing() } }}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-3 py-1 text-2xl font-bold text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
        <Button type="submit" size="sm" loading={update.isPending} disabled={!title.trim()}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={stopEditing}>Cancel</Button>
      </form>
    )
  }

  return (
    <div className="flex items-start gap-1">
      <h1 className="text-2xl font-bold text-neutral-900">{podcast.title}</h1>
      {podcast.stage !== 'legacy' && (
        <Tooltip content={blocked ?? 'Edit title'}>
          {trigger => (
            <button
              ref={pencil}
              type="button"
              aria-label="Edit title"
              aria-disabled={blocked ? true : undefined}
              onClick={() => { if (!blocked) { setTitle(podcast.title); setEditing(true) } }}
              className={`mt-1 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${blocked ? 'cursor-not-allowed text-neutral-300' : 'text-neutral-500 hover:text-neutral-800'}`}
              {...trigger}
            >
              <PencilSquareIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </Tooltip>
      )}
    </div>
  )
}
