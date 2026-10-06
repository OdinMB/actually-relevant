import type { Podcast, PodcastUsage } from '@shared/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { usePodcastUsage } from '../../hooks/usePodcasts'

const fmt = (n: number) => n.toLocaleString('en-US')

/** What a voicing of the current script costs, and where the month stands against the cap. */
export function voiceCostText(podcast: Pick<Podcast, 'dryRun' | 'ttsCharsEstimate'>, usage: PodcastUsage | undefined): string {
  if (podcast.dryRun) return 'Dry run: the silent stub voice is used, so no credits are spent.'
  const chars = podcast.ttsCharsEstimate
  const estimate = chars == null
    ? 'The script is not written yet, so its length is not known.'
    : `Voicing sends about ${fmt(chars)} characters to ElevenLabs, about ${fmt(chars)} credits at 1 credit per character.`
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
