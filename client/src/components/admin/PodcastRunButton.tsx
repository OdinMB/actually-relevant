import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Podcast, PodcastMode } from '@shared/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { useResumePodcast } from '../../hooks/usePodcasts'
import { PodcastVoiceConfirm } from './PodcastVoiceConfirm'
import { runVoices } from './podcastRun'

interface PodcastRunButtonProps {
  podcast: Podcast
  /** The mode to run in; omitted, the stored one. */
  mode?: PodcastMode
  /** The question asked first when the run will voice (and so spend credits). */
  confirmTitle?: string
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md'
  disabled?: boolean
  'aria-describedby'?: string
  children: ReactNode
}

/**
 * Starts, approves, finishes automatically or resumes a run (`POST /:id/resume`). A run that will
 * voice the episode asks first, with its cost (owner, 2026-10-06); any other starts at once.
 */
export function PodcastRunButton({ podcast, mode, confirmTitle = 'Write and voice the episode?', variant = 'primary', size = 'md', disabled, children, ...rest }: PodcastRunButtonProps) {
  const resume = useResumePodcast()
  const { toast } = useToast()
  const [asking, setAsking] = useState(false)

  const run = () => resume.mutate({ id: podcast.id, mode }, {
    onError: err => toast('error', err instanceof Error ? err.message : 'Failed to start'),
    onSettled: () => setAsking(false),
  })

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => (runVoices(podcast, mode) ? setAsking(true) : run())}
        loading={resume.isPending}
        disabled={disabled}
        aria-describedby={rest['aria-describedby']}
      >
        {children}
      </Button>
      {asking && (
        <PodcastVoiceConfirm
          open
          podcast={podcast}
          title={confirmTitle}
          confirmLabel={podcast.stage === 'scripted' ? 'Voice it' : 'Write and voice it'}
          loading={resume.isPending}
          onClose={() => setAsking(false)}
          onConfirm={run}
        />
      )}
    </>
  )
}
