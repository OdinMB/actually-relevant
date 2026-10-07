import { useId, type ReactNode } from 'react'
import type { Podcast } from '@shared/types'
import { PodcastRunButton } from './PodcastRunButton'
import { stepRunState, type StepRun } from './podcastRun'

interface PodcastStepRunButtonProps {
  podcast: Podcast
  step: StepRun
  pendingEdits: boolean
  /** Asked before a run that voices, with its cost. */
  confirmTitle?: string
  children: ReactNode
}

/**
 * A tab's own primary run (Write script, Voice script): the same run as the review approval on the
 * tab before, shown disabled with its reason in visible text until the step before it is done.
 */
export function PodcastStepRunButton({ podcast, step, pendingEdits, confirmTitle, children }: PodcastStepRunButtonProps) {
  const reasonId = useId()
  const state = stepRunState(podcast, step, pendingEdits)
  if (!state) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <PodcastRunButton
        podcast={podcast}
        confirmTitle={confirmTitle}
        disabled={state.reason !== null}
        aria-describedby={state.reason ? reasonId : undefined}
      >
        {children}
      </PodcastRunButton>
      {state.reason && <span id={reasonId} className="text-sm text-neutral-600">{state.reason}</span>}
    </div>
  )
}
