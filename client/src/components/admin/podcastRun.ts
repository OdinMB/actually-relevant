import type { Podcast, PodcastMode } from '@shared/types'
import { wasPublished } from './podcastPublished'

export type NextAction = 'choose-mode' | 'approve-stories' | 'approve-script' | 'resume'

/** What a person can do next at rest; null while a run works, once ready, published or legacy. */
export function nextAction(podcast: Podcast): NextAction | null {
  if (podcast.inProgress || podcast.stage === 'legacy' || podcast.stage === 'ready' || wasPublished(podcast)) return null
  if (podcast.stage === 'created' && !podcast.mode) return 'choose-mode'
  if (podcast.awaitingReview) return podcast.stage === 'selected' ? 'approve-stories' : 'approve-script'
  return 'resume'
}

/**
 * Whether continuing would reach the paid voicing: from the script on in any mode, and before it
 * when the run is automated (the mode given now, or the stored one). An interactive run before the
 * script stops at the next review, so it spends nothing on TTS.
 */
export function runVoices(podcast: Pick<Podcast, 'stage' | 'mode'>, mode?: PodcastMode): boolean {
  if (podcast.stage === 'scripted') return true
  const before = podcast.stage === 'created' || podcast.stage === 'selected'
  return before && (mode ?? podcast.mode) === 'automated'
}

/** Changes that discard work (start over, change stories, regenerate, delete) are refused while a run works and once ever published. */
export function atRestAndChangeable(podcast: Podcast): boolean {
  return podcast.stage !== 'legacy' && !podcast.inProgress && !wasPublished(podcast)
}
