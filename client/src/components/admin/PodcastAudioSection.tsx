import { useState } from 'react'
import type { Podcast } from '@shared/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { usePodcastUsage, useRewindPodcast } from '../../hooks/usePodcasts'
import { PodcastVoiceConfirm } from './PodcastVoiceConfirm'
import { PodcastPublishControls } from './PodcastPublishControls'
import { wasPublished } from './podcastPublished'

function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

type AudioAction = 'regenerate' | 'edit'

const CONFIRM: Record<AudioAction, { title: string; confirmLabel: string; note: string }> = {
  regenerate: {
    title: 'Voice the episode again?',
    confirmLabel: 'Regenerate audio',
    note: 'The current audio is discarded and the same script is voiced again with a new take.',
  },
  edit: {
    title: 'Edit the script?',
    confirmLabel: 'Edit script',
    note: 'The current audio is discarded. After your edits, approving the script voices it again.',
  },
}

/** What a person does with a finished episode: listen, change it while it was never published, publish or unpublish. */
function NextSteps({ podcast, canChange }: { podcast: Podcast; canChange: boolean }) {
  return (
    <div className="rounded-md border border-brand-100 bg-brand-50 p-3 text-sm text-neutral-800 space-y-3">
      <h4 className="font-semibold text-neutral-900">Next steps</h4>
      {canChange && (
        <ol className="list-decimal pl-5 space-y-1">
          <li>Listen to the episode above, including the transitions between stories.</li>
          <li>If something sounds off, regenerate the audio for a new take, or edit the script and voice it again.</li>
          <li>When it sounds right, publish it. It then appears in the podcast feed and on the podcast page.</li>
        </ol>
      )}
      <PodcastPublishControls podcast={podcast} />
    </div>
  )
}

/**
 * The episode's audio as stored on the CDN, the TTS characters it and the month have used, and,
 * once it is ready, Regenerate audio and Edit script (until first published) and the next steps.
 */
export function PodcastAudioSection({ podcast }: { podcast: Podcast }) {
  const usage = usePodcastUsage()
  const rewind = useRewindPodcast()
  const { toast } = useToast()
  const [confirm, setConfirm] = useState<AudioAction | null>(null)
  const ready = podcast.stage === 'ready'
  const atRest = ready && !podcast.inProgress
  const canChange = atRest && !wasPublished(podcast)

  const handleConfirm = () => {
    if (!confirm) return
    rewind.mutate({ id: podcast.id, to: 'scripted', advance: confirm === 'regenerate' }, {
      onError: err => toast('error', err instanceof Error ? err.message : 'Failed'),
      onSettled: () => setConfirm(null),
    })
  }

  return (
    <section aria-labelledby="podcast-audio-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3">
      <h3 id="podcast-audio-heading" className="text-sm font-semibold text-neutral-900">Audio</h3>
      {podcast.audioUrl ? (
        <>
          <audio controls preload="none" src={podcast.audioUrl} className="w-full" aria-label={`Episode audio: ${podcast.title}`} />
          <p className="text-sm text-neutral-700">
            {podcast.durationSec != null && <>Duration {formatDuration(podcast.durationSec)}</>}
            {podcast.dryRun && <> · Dry run: silent stub voice, not for publishing</>}
          </p>
        </>
      ) : (
        <p className="text-sm text-neutral-500 italic">
          {podcast.stage === 'voiced' ? 'Voiced; the MP3 is not uploaded yet.' : 'No audio yet.'}
        </p>
      )}
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
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setConfirm('regenerate')} disabled={rewind.isPending}>Regenerate audio</Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirm('edit')} disabled={rewind.isPending}>Edit script</Button>
        </div>
      )}
      {atRest && <NextSteps podcast={podcast} canChange={canChange} />}

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
