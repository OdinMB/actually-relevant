import type { Podcast } from '@shared/types'
import { usePodcastUsage } from '../../hooks/usePodcasts'

function formatDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/** The episode's audio as stored on the CDN, and the TTS characters it and the month have used. */
export function PodcastAudioSection({ podcast }: { podcast: Podcast }) {
  const usage = usePodcastUsage()

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
    </section>
  )
}
