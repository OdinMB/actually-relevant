import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import type { JobRun } from '@shared/types'
import { useAlertChannel } from '../../hooks/useJobs'

/** The jobs whose failures and notices the owner would otherwise only learn of on these pages. */
const PODCAST_JOBS: readonly string[] = ['generate_podcast', 'publish_podcast']

/** Warn while a podcast job is enabled and the server has no alert channel (an unknown answer stays quiet). */
export function needsAlertChannelWarning(jobs: JobRun[], alertChannelConfigured: boolean | undefined): boolean {
  return alertChannelConfigured === false && jobs.some(j => j.enabled && PODCAST_JOBS.includes(j.jobName))
}

/** A persistent, non-blocking notice above the Jobs table; nothing requires an alert channel. */
export function AlertChannelWarning({ jobs }: { jobs: JobRun[] }) {
  const alertChannel = useAlertChannel()
  if (!needsAlertChannelWarning(jobs, alertChannel.data?.configured)) return null

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p>
        No alert channel is set: failures and &ldquo;episode ready&rdquo; notices are only visible here and on the Podcasts page.
      </p>
    </div>
  )
}
