import { useState } from 'react'
import type { Podcast, PodcastMode, PodcastStage } from '@shared/types'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { useToast } from '../ui/Toast'
import { useResumePodcast, useRewindPodcast } from '../../hooks/usePodcasts'
import { PodcastVoiceConfirm } from './PodcastVoiceConfirm'
import { wasPublished } from './podcastPublished'

const STEPS: { stage: PodcastStage; label: string }[] = [
  { stage: 'selected', label: 'Select stories' },
  { stage: 'scripted', label: 'Write script' },
  { stage: 'voiced', label: 'Voice' },
  { stage: 'ready', label: 'Ready' },
]
const ORDER: PodcastStage[] = ['created', 'selected', 'scripted', 'voiced', 'ready']

type StepState = 'done' | 'running' | 'next' | 'todo'

/** Each step's state: done once the episode reached it, running while a process works toward it. */
export function stepStates(podcast: Pick<Podcast, 'stage' | 'inProgress'>): StepState[] {
  const at = ORDER.indexOf(podcast.stage)
  return STEPS.map(step => {
    const index = ORDER.indexOf(step.stage)
    if (index <= at) return 'done'
    if (index === at + 1) return podcast.inProgress ? 'running' : 'next'
    return 'todo'
  })
}

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

const MODE_LABEL: Record<PodcastMode, string> = { interactive: 'Interactive: review after each step', automated: 'Fully automated' }

function StepMarker({ state, index }: { state: StepState; index: number }) {
  if (state === 'running') return <LoadingSpinner size="sm" />
  const tone = state === 'done' ? 'bg-brand-700 text-white' : 'bg-neutral-100 text-neutral-600'
  return <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${tone}`}>{state === 'done' ? '✓' : index + 1}</span>
}

interface PodcastStageStepperProps {
  podcast: Podcast
  /** The story picker or script editor holds unsaved changes: approving would lose them. */
  pendingEdits?: boolean
}

/**
 * Where the episode is and what can happen next: the steps (a spinner on the one running), the
 * mode choice for a new episode, and approve, continue, "finish automatically" or start over.
 */
export function PodcastStageStepper({ podcast, pendingEdits = false }: PodcastStageStepperProps) {
  const resume = useResumePodcast()
  const rewind = useRewindPodcast()
  const { toast } = useToast()
  const [voiceConfirm, setVoiceConfirm] = useState<{ mode?: PodcastMode; title: string } | null>(null)
  const [confirmStartOver, setConfirmStartOver] = useState(false)

  const action = nextAction(podcast)
  const busy = resume.isPending || rewind.isPending
  const states = stepStates(podcast)

  const run = (mode?: PodcastMode) => resume.mutate({ id: podcast.id, mode }, {
    onError: err => toast('error', err instanceof Error ? err.message : 'Failed to start'),
    onSettled: () => setVoiceConfirm(null),
  })

  /** A run that will voice the episode asks first, with its cost (owner, 2026-10-06). */
  const runOrConfirm = (title: string, mode?: PodcastMode) => (runVoices(podcast, mode) ? setVoiceConfirm({ mode, title }) : run(mode))
  const writesFirst = podcast.stage !== 'scripted'

  const startOver = () => rewind.mutate({ id: podcast.id, to: 'created', advance: true }, {
    onError: err => toast('error', err instanceof Error ? err.message : 'Failed to start over'),
    onSettled: () => setConfirmStartOver(false),
  })

  const canStartOver = !podcast.inProgress && !wasPublished(podcast) && podcast.stage !== 'created'

  return (
    <section aria-labelledby="podcast-steps-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="podcast-steps-heading" className="text-sm font-semibold text-neutral-900">Production</h3>
        {podcast.mode && <span className="text-sm text-neutral-600">{MODE_LABEL[podcast.mode]}</span>}
      </div>

      <ol aria-label="Production steps" className="flex flex-wrap gap-x-6 gap-y-2">
        {STEPS.map((step, i) => (
          <li key={step.stage} aria-current={states[i] === 'running' || states[i] === 'next' ? 'step' : undefined} className="flex items-center gap-2 text-sm">
            <StepMarker state={states[i]} index={i} />
            <span className={states[i] === 'todo' ? 'text-neutral-500' : 'text-neutral-900'}>{step.label}</span>
            <span className="sr-only">{states[i] === 'done' ? '(done)' : states[i] === 'running' ? '(running)' : ''}</span>
          </li>
        ))}
      </ol>

      <p role="status" aria-live="polite" className="text-sm text-neutral-700 min-h-[1.25rem]">
        {podcast.inProgress ? `${podcast.activity ?? 'Working'}… This runs on the server; you can leave this page.` : ''}
      </p>

      {action === 'choose-mode' && (
        <div className="space-y-2">
          <p className="text-sm text-neutral-700">How should this episode be made?</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run('interactive')} loading={busy}>Interactive (review each step)</Button>
            <Button variant="secondary" onClick={() => runOrConfirm('Write and voice the whole episode?', 'automated')} loading={busy}>Fully automated</Button>
          </div>
          <p className="text-xs text-neutral-500">Interactive stops after the stories are chosen and after the script is written, so you can change them. Fully automated selects, writes, voices and assembles in one go.</p>
        </div>
      )}

      {(action === 'approve-stories' || action === 'approve-script') && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {action === 'approve-stories' ? (
              <>
                <Button onClick={() => run()} loading={busy} disabled={pendingEdits}>Approve stories and write the script</Button>
                <Button variant="secondary" onClick={() => runOrConfirm('Write the script and voice it without review?', 'automated')} disabled={busy || pendingEdits}>Finish automatically</Button>
              </>
            ) : (
              <Button onClick={() => runOrConfirm('Approve the script and voice it?')} loading={busy} disabled={pendingEdits}>Approve script and voice it</Button>
            )}
          </div>
          {pendingEdits && <p className="text-xs text-neutral-600">Save or discard your changes first.</p>}
        </div>
      )}

      {action === 'resume' && (
        <Button onClick={() => runOrConfirm(writesFirst ? 'Resume, then write and voice the episode?' : 'Resume and voice the episode?')} loading={busy}>Resume</Button>
      )}

      {canStartOver && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setConfirmStartOver(true)} disabled={busy}>Start over</Button>
        </div>
      )}

      {voiceConfirm && (
        <PodcastVoiceConfirm
          open
          podcast={podcast}
          title={voiceConfirm.title}
          confirmLabel={writesFirst ? 'Write and voice it' : 'Voice it'}
          loading={resume.isPending}
          onClose={() => setVoiceConfirm(null)}
          onConfirm={() => run(voiceConfirm.mode)}
        />
      )}
      <ConfirmDialog
        open={confirmStartOver}
        onClose={() => setConfirmStartOver(false)}
        onConfirm={startOver}
        title="Start this episode over?"
        description="The stories, script and audio are discarded and new stories are selected. The episode then waits for your review."
        variant="danger"
        confirmLabel="Start over"
        loading={rewind.isPending}
      />
    </section>
  )
}
