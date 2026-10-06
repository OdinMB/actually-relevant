import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ActivePodcastRun, Podcast } from '@shared/types'
import { useToast, type ToastUpdate } from '../components/ui/Toast'
import { adminApi } from '../lib/admin-api'

/** How often the running episodes are re-read while any is followed. */
export const PODCAST_PROGRESS_POLL_MS = 3000
const MAX_REASON_CHARS = 160

const toastId = (id: string) => `podcast-${id}`
export const podcastPath = (id: string) => `/admin/podcasts/${id}`

/** The progress toast's text: the episode, the step, and the chunks while voicing. */
export function progressMessage(run: ActivePodcastRun): string {
  const chunks = run.chunksTotal ? ` ${run.chunksDone ?? 0}/${run.chunksTotal}` : ''
  return `${run.title}: ${run.activity ?? 'Working'}${chunks}`
}

const STOP_MESSAGES: Partial<Record<Podcast['stage'], string>> = {
  selected: 'Stories selected: review them',
  scripted: 'Script ready: review it',
  ready: 'Episode ready to listen',
}

const shorten = (text: string) => (text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text)

/** The toast a finished run turns into: a failure stays until dismissed; a success fades as usual. */
export function runOutcome(podcast: Podcast): Required<Pick<ToastUpdate, 'type' | 'message' | 'sticky'>> {
  if (podcast.blockedAt) return { type: 'error', message: `${podcast.title}: blocked. ${shorten(podcast.blockedReason ?? '')}`.trim(), sticky: true }
  if (podcast.lastError) return { type: 'error', message: `${podcast.title}: failed. ${shorten(podcast.lastError)}`, sticky: true }
  return { type: 'success', message: `${podcast.title}: ${STOP_MESSAGES[podcast.stage] ?? 'Stopped'}`, sticky: false }
}

interface PodcastProgressValue {
  /** Follow an episode whose run the server just accepted (202): one persistent toast until it ends. */
  track: (id: string) => void
}

const PodcastProgressContext = createContext<PodcastProgressValue | null>(null)

/**
 * Follows running podcast episodes across the admin (ADR-0009). Mounted once in the admin layout,
 * so the work and its toast survive navigation; the server runs the episode, this only watches.
 * It asks which episodes are running on mount and on window focus (which reattaches after a
 * reload, or to a run another tab or the cron started), polls while it follows any, and keeps one
 * clickable toast per episode that never fades while the run lasts and turns into the outcome.
 */
export function PodcastProgressProvider({ children }: { children: ReactNode }) {
  const { addProgressToast, updateToast } = useToast()
  const queryClient = useQueryClient()
  /** Followed episodes and when following began: a poll sent before that cannot know the run yet. */
  const followed = useRef(new Map<string, number>())
  const polling = useRef(false)
  const pollAgain = useRef(false)
  const [followedCount, setFollowedCount] = useState(0)

  const finish = useCallback(async (id: string) => {
    try {
      const outcome = runOutcome(await adminApi.podcasts.get(id))
      updateToast(toastId(id), { ...outcome, href: podcastPath(id) })
    } catch {
      updateToast(toastId(id), { type: 'error', message: 'Could not read how the episode run ended; open the episode to check', sticky: true })
    }
    queryClient.invalidateQueries({ queryKey: ['podcast', id] })
    queryClient.invalidateQueries({ queryKey: ['podcasts'] })
    queryClient.invalidateQueries({ queryKey: ['podcast-usage'] })
  }, [updateToast, queryClient])

  const poll = useCallback(async (): Promise<void> => {
    if (polling.current) {
      // One more read once the current one is back: it was sent before whatever asked for this one.
      pollAgain.current = true
      return
    }
    polling.current = true
    const sentAt = Date.now()
    try {
      const runs = await adminApi.podcasts.active()
      const running = new Map(runs.map(run => [run.id, run]))
      for (const run of runs) {
        if (!followed.current.has(run.id)) followed.current.set(run.id, sentAt)
        addProgressToast(toastId(run.id), progressMessage(run), { href: podcastPath(run.id) })
      }
      for (const [id, since] of [...followed.current]) {
        if (running.has(id) || since > sentAt) continue
        followed.current.delete(id)
        void finish(id)
      }
      setFollowedCount(followed.current.size)
    } catch {
      // A transient failure: the next poll or focus tries again.
    } finally {
      polling.current = false
    }
    if (pollAgain.current) {
      pollAgain.current = false
      await poll()
    }
  }, [addProgressToast, finish])

  const track = useCallback((id: string) => {
    followed.current.set(id, Date.now())
    addProgressToast(toastId(id), 'Starting…', { href: podcastPath(id) })
    setFollowedCount(followed.current.size)
    void poll()
  }, [addProgressToast, poll])

  useEffect(() => {
    void poll()
    const onFocus = () => void poll()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [poll])

  useEffect(() => {
    if (followedCount === 0) return
    const timer = setInterval(() => void poll(), PODCAST_PROGRESS_POLL_MS)
    return () => clearInterval(timer)
  }, [followedCount, poll])

  const value = useMemo(() => ({ track }), [track])
  return <PodcastProgressContext.Provider value={value}>{children}</PodcastProgressContext.Provider>
}

export function usePodcastProgress(): PodcastProgressValue {
  const ctx = useContext(PodcastProgressContext)
  if (!ctx) throw new Error('usePodcastProgress must be used within PodcastProgressProvider')
  return ctx
}
