import { useEffect, useMemo, useState } from 'react'
import type { Podcast, PodcastPoolStory } from '@shared/types'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { useToast } from '../ui/Toast'
import { ApiError } from '../../lib/admin-api'
import { usePodcastStoryPool, useSavePodcastStories } from '../../hooks/usePodcasts'

/** The chosen ids with the story at `index` replaced in place. */
export function swapStory(chosen: string[], index: number, id: string): string[] {
  return chosen.map((current, i) => (i === index ? id : current))
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

function StoryLine({ story }: { story: PodcastPoolStory | undefined }) {
  if (!story) return <span className="text-neutral-500 italic">No longer in this week&apos;s pool</span>
  return (
    <span>
      <span className="text-neutral-900">{story.title}</span>{' '}
      <span className="text-neutral-500">({story.publisher}, {story.issue})</span>
    </span>
  )
}

interface PodcastStoryPickerProps {
  podcast: Podcast
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Choosing the episode's stories from the week's pool, at `selected`: swap a story in place,
 * remove one or add one at the end, within the minimum and maximum; then save.
 */
export function PodcastStoryPicker({ podcast, onDirtyChange }: PodcastStoryPickerProps) {
  const pool = usePodcastStoryPool(podcast.id, true)
  const save = useSavePodcastStories()
  const { toast } = useToast()
  const [chosen, setChosen] = useState<string[]>(podcast.storyIds)
  const [errors, setErrors] = useState<string[]>([])

  // When the saved stories change on the server, the picker follows them.
  const savedKey = podcast.storyIds.join(',')
  const [shownKey, setShownKey] = useState(savedKey)
  if (savedKey !== shownKey) {
    setShownKey(savedKey)
    setChosen(podcast.storyIds)
  }

  const dirty = !sameOrder(chosen, podcast.storyIds)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const byId = useMemo(() => new Map((pool.data?.stories ?? []).map(s => [s.id, s])), [pool.data])
  const others = (pool.data?.stories ?? []).filter(s => !chosen.includes(s.id))

  if (pool.isLoading) return <div className="flex justify-center py-6"><LoadingSpinner /></div>
  if (pool.error || !pool.data) return <p role="alert" className="text-sm text-red-700">Failed to load this week&apos;s stories.</p>
  const { minStories, maxStories } = pool.data

  const handleSave = () => {
    setErrors([])
    save.mutate({ id: podcast.id, storyIds: chosen }, {
      onSuccess: () => toast('success', 'Stories saved'),
      onError: err => {
        const body = err instanceof ApiError ? (err.body as { errors?: string[] } | undefined) : undefined
        setErrors(body?.errors ?? [err instanceof Error ? err.message : 'Failed to save the stories'])
      },
    })
  }

  return (
    <section aria-labelledby="podcast-stories-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4">
      <div>
        <h2 id="podcast-stories-heading" className="text-sm font-semibold text-neutral-900">Stories in this episode</h2>
        <p className="text-xs text-neutral-600 mt-1">{minStories} to {maxStories} stories, in the order they are discussed. A swapped-in story takes the place of the one it replaces.</p>
      </div>

      <ol className="space-y-3">
        {chosen.map((id, i) => (
          <li key={`${i}-${id}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-5 text-neutral-500">{i + 1}.</span>
            <span className="flex-1 min-w-[12rem]"><StoryLine story={byId.get(id)} /></span>
            <label htmlFor={`swap-${i}`} className="sr-only">Swap story {i + 1} for another story</label>
            <select
              id={`swap-${i}`}
              value=""
              onChange={e => e.target.value && setChosen(swapStory(chosen, i, e.target.value))}
              disabled={others.length === 0}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 max-w-[14rem]"
            >
              <option value="">Swap for…</option>
              {others.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChosen(chosen.filter((_, j) => j !== i))}
              disabled={chosen.length <= minStories}
              aria-label={`Remove story ${i + 1}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ol>

      {others.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-neutral-800 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            Other published stories this week ({others.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {others.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 min-w-[12rem]"><StoryLine story={s} /></span>
                <Button variant="secondary" size="sm" onClick={() => setChosen([...chosen, s.id])} disabled={chosen.length >= maxStories} aria-label={`Add ${s.title}`}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <ul className="list-disc pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* Always shown (disabled while nothing changed), so the form does not shift when an edit starts */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={handleSave} loading={save.isPending} disabled={!dirty}>Save selection</Button>
        <Button size="sm" variant="ghost" onClick={() => { setChosen(podcast.storyIds); setErrors([]) }} disabled={!dirty || save.isPending}>Discard changes</Button>
      </div>
    </section>
  )
}
