import { useState } from 'react'
import type { Podcast } from '@shared/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { usePodcastUsage, useRewindPodcast } from '../../hooks/usePodcasts'
import { PodcastStepRunButton } from './PodcastStepRunButton'
import { PodcastVoiceConfirm } from './PodcastVoiceConfirm'
import { atRestAndChangeable } from './podcastRun'

export function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

type AudioAction = 'regenerate' | 'back'

const CONFIRM: Record<AudioAction, { title: string; confirmLabel: string; note: string }> = {
  regenerate: {
    title: 'Voice the episode again?',
    confirmLabel: 'Regenerate audio',
    note: 'The current audio is discarded and the same script is voiced again with a new take.',
  },
  back: {
    title: 'Go back to the script?',
    confirmLabel: 'Back to script',
    note: 'The current audio is discarded. After your edits, approving the script voices it again.',
  },
}

function AudioStatus({ podcast }: { podcast: Podcast }) {
  if (podcast.inProgress && (podcast.stage === 'scripted' || podcast.stage === 'voiced')) {
    return <p className="text-sm text-neutral-800">{podcast.activity ?? 'Working'}… The player appears in the bar below once the MP3 is uploaded.</p>
  }
  if (podcast.audioUrl) {
    return (
      <p className="text-sm text-neutral-700">
        {podcast.durationSec != null && <>Duration {formatDuration(podcast.durationSec)}. </>}
        Play it in the bar below.
        {podcast.dryRun && <> Dry run: silent stub voice, not for publishing.</>}
      </p>
    )
  }
  return (
    <p className="text-sm italic text-neutral-500">
      {podcast.stage === 'voiced' ? 'Voiced; the MP3 is not uploaded yet.' : 'No audio yet.'}
    </p>
  )
}

interface PodcastAudioTabProps {
  podcast: Podcast
  pendingEdits: boolean
  /** After Back to script: the page shows the Script tab. */
  onBackToScript: () => void
}

/**
 * The Audio stage: Voice script until the episode is voiced (with its cost; disabled with its reason
 * until there is a script), voicing progress or the episode's duration, the TTS characters it and
 * the month have used, and while a ready episode was never published Regenerate audio and Back to
 * script, both behind a confirmation (Regenerate with its cost). Playing and publishing live in the bar.
 */
export function PodcastAudioTab({ podcast, pendingEdits, onBackToScript }: PodcastAudioTabProps) {
  const usage = usePodcastUsage()
  const rewind = useRewindPodcast()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<AudioAction | null>(null)
  const canChange = podcast.stage === 'ready' && atRestAndChangeable(podcast)

  const handleConfirm = () => {
    if (!confirm) return
    const back = confirm === 'back'
    rewind.mutate({ id: podcast.id, to: 'scripted', advance: !back }, {
      onSuccess: () => { if (back) onBackToScript() },
      onError: err => toast('error', err instanceof Error ? err.message : 'Failed'),
      onSettled: () => setConfirm(null),
    })
  }

  return (
    <section aria-labelledby="podcast-audio-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3">
      <h2 id="podcast-audio-heading" className="text-sm font-semibold text-neutral-900">Audio</h2>
      <AudioStatus podcast={podcast} />
      <PodcastStepRunButton podcast={podcast} step="voice-script" pendingEdits={pendingEdits} confirmTitle="Approve the script and voice it?">
        Voice script
      </PodcastStepRunButton>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-neutral-700">
        <dt className="text-neutral-500">TTS characters, this episode</dt>
        <dd>{podcast.ttsChars.toLocaleString('en-US')}</dd>
        <dt className="text-neutral-500">TTS characters, this month</dt>
        <dd>
          {usage.data
            ? `${usage.data.monthToDateChars.toLocaleString('en-US')} of ${usage.data.monthlyCap.toLocaleString('en-US')}`
            : '…'}
        </dd>
      </dl>

      {canChange && (
        <>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-neutral-800">
            <li>Listen to the episode, including the transitions between stories.</li>
            <li>If something sounds off, regenerate the audio for a new take, or go back to the script and voice it again.</li>
            <li>When it sounds right, publish it from the bar below. It then appears in the podcast feed and on the podcast page.</li>
          </ol>
          <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
            <Button size="sm" variant="secondary" onClick={() => setConfirm('regenerate')} disabled={rewind.isPending}>Regenerate audio</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('back')} disabled={rewind.isPending}>Back to script</Button>
          </div>
        </>
      )}

      {confirm && (
        <PodcastVoiceConfirm
          open
          podcast={podcast}
          {...CONFIRM[confirm]}
          loading={rewind.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={handleConfirm}
        />
      )}
    </section>
  )
}
