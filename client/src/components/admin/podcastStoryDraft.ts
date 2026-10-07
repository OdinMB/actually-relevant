import { useEffect, useState } from 'react'
import type { Podcast } from '@shared/types'
import { useToast } from '../ui/Toast'
import { ApiError } from '../../lib/admin-api'
import { useSavePodcastStories } from '../../hooks/usePodcasts'

/** The chosen ids with the story at `index` moved by `delta` places; unchanged when that leaves the list. */
export function moveStory(chosen: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta
  if (index < 0 || index >= chosen.length || target < 0 || target >= chosen.length) return chosen
  const next = [...chosen]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The 422 errors of a failed save, or its message. */
function saveErrors(err: unknown): string[] {
  const body = err instanceof ApiError ? (err.body as { errors?: string[] } | undefined) : undefined
  return body?.errors ?? [err instanceof Error ? err.message : 'Failed to save the stories']
}

export interface PodcastStoryDraft {
  chosen: string[]
  setChosen: (ids: string[]) => void
  /** The draft differs from the saved stories (set or order). */
  dirty: boolean
  errors: string[]
  saving: boolean
  save: () => void
  discard: () => void
}

/**
 * The chosen-stories draft both story pickers edit: it follows the saved stories when they change on
 * the server, reports whether it is dirty, and saves (showing a 422's errors) or discards.
 */
export function usePodcastStoryDraft(podcast: Podcast, onDirtyChange?: (dirty: boolean) => void): PodcastStoryDraft {
  const saveStories = useSavePodcastStories()
  const { toast } = useToast()
  const [chosen, setChosen] = useState<string[]>(podcast.storyIds)
  const [errors, setErrors] = useState<string[]>([])

  // When the saved stories change on the server, the draft follows them.
  const savedKey = podcast.storyIds.join(',')
  const [shownKey, setShownKey] = useState(savedKey)
  if (savedKey !== shownKey) {
    setShownKey(savedKey)
    setChosen(podcast.storyIds)
  }

  const dirty = !sameOrder(chosen, podcast.storyIds)
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const save = () => {
    setErrors([])
    saveStories.mutate({ id: podcast.id, storyIds: chosen }, {
      onSuccess: () => toast('success', 'Stories saved'),
      onError: err => setErrors(saveErrors(err)),
    })
  }
  const discard = () => {
    setChosen(podcast.storyIds)
    setErrors([])
  }

  return { chosen, setChosen, dirty, errors, saving: saveStories.isPending, save, discard }
}
