import type { Podcast, PodcastUsage } from '@shared/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { usePodcastUsage } from '../../hooks/usePodcasts'

const fmt = (n: number) => n.toLocaleString('en-US')

/** The planning rate until S2 is re-measured after the eleven_v4 launch promotion (plan, "Cost"). */
const CREDITS_PER_CHAR = 1
const credits = (chars: number) => `${fmt(Math.round(chars * CREDITS_PER_CHAR))} credits at ${CREDITS_PER_CHAR} credit per character`

/**
 * What a voicing costs, and where the month stands against the cap: the current script's own
 * figure once it exists, otherwise a typical episode with the largest valid one beside it.
 */
export function voiceCostText(podcast: Pick<Podcast, 'dryRun' | 'ttsCharsEstimate'>, usage: PodcastUsage | undefined): string {
  if (podcast.dryRun) return 'Dry run: the silent stub voice is used, so no credits are spent.'
  const chars = podcast.ttsCharsEstimate
  let estimate: string
  if (chars != null) {
    estimate = `Voicing sends about ${fmt(chars)} characters to ElevenLabs, about ${credits(chars)}.`
  } else if (usage) {
    const typical = usage.typicalEpisodeChars
    estimate = `This writes and voices the episode: typically about ${fmt(typical)} characters (at most ${fmt(usage.maxEpisodeChars)}), about ${credits(typical)}.`
  } else {
    estimate = 'The script is not written yet, so its length is not known.'
  }
  const month = usage ? ` This month: ${fmt(usage.monthToDateChars)} of ${fmt(usage.monthlyCap)} characters used.` : ''
  return estimate + month
}

interface PodcastVoiceConfirmProps {
  open: boolean
  podcast: Podcast
  title: string
  confirmLabel: string
  /** What else the action does, before the cost (e.g. "The current audio is discarded."). */
  note?: string
  loading?: boolean
  onClose: () => void
  onConfirm: () => void
}

/** The confirmation before any action that voices the episode: estimated characters, credits and the month to date. */
export function PodcastVoiceConfirm({ open, podcast, title, confirmLabel, note, loading, onClose, onConfirm }: PodcastVoiceConfirmProps) {
  const usage = usePodcastUsage()
  const description = [note, voiceCostText(podcast, usage.data)].filter(Boolean).join(' ')
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      loading={loading}
    />
  )
}
