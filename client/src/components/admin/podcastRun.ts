import type { Podcast, PodcastMode, PodcastStage } from '@shared/types'
import { wasPublished } from './podcastPublished'

export type NextAction = 'choose-stories' | 'choose-mode' | 'approve-stories' | 'approve-script' | 'resume'

/**
 * What a person can do next at rest; null while a run works, once ready, published or legacy. A
 * standalone episode at `created` waits for a person to choose its stories, whatever its mode: no run
 * selects them.
 */
export function nextAction(podcast: Podcast): NextAction | null {
  if (podcast.inProgress || podcast.stage === 'legacy' || podcast.stage === 'ready' || wasPublished(podcast)) return null
  if (podcast.kind === 'standalone' && podcast.stage === 'created') return 'choose-stories'
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

/** A tab's own run button: Write script on the Script tab, Voice script on the Audio tab. */
export type StepRun = 'write-script' | 'voice-script'

const STEP_RUN: Record<StepRun, { before: PodcastStage[]; at: PodcastStage; action: NextAction; notYet: string }> = {
  'write-script': { before: ['created'], at: 'selected', action: 'approve-stories', notYet: 'Choose and save the stories first.' },
  'voice-script': { before: ['created', 'selected'], at: 'scripted', action: 'approve-script', notYet: 'There is no script to voice yet.' },
}

/**
 * Whether a tab's run button shows and why it is disabled: null (hidden) once its work exists, or on
 * a published or legacy episode; otherwise `reason` is null when it can run now (the same run as the
 * review approval) and says why not when it cannot.
 */
export function stepRunState(podcast: Podcast, step: StepRun, pendingEdits: boolean): { reason: string | null } | null {
  const def = STEP_RUN[step]
  const reachable = def.before.includes(podcast.stage) || podcast.stage === def.at
  if (!reachable || wasPublished(podcast)) return null
  if (podcast.inProgress) return { reason: 'A run is working on the episode.' }
  if (podcast.stage !== def.at) return { reason: def.notYet }
  if (pendingEdits) return { reason: 'Save or discard your changes first.' }
  if (nextAction(podcast) !== def.action) return { reason: 'This episode is not waiting for review; Resume in the bar below continues it.' }
  return { reason: null }
}

/** Changes that discard work (start over, change stories, regenerate, delete) are refused while a run works and once ever published. */
export function atRestAndChangeable(podcast: Podcast): boolean {
  return podcast.stage !== 'legacy' && !podcast.inProgress && !wasPublished(podcast)
}
