import type { JobRun } from '@shared/types'
import { formatDateWithTime } from '../../lib/constants'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'

type Variant = 'dot' | 'badge'

interface JobStatusBadgeProps {
  job: Pick<JobRun, 'running' | 'enabled' | 'lastError' | 'lastCompletedAt' | 'lastStartedAt'>
  variant?: Variant
}

/** `explanation`: what the state means, for a state the label alone does not explain. */
type StatusInfo = { label: string; color: 'yellow' | 'red' | 'green' | 'gray'; explanation?: string }

function getStatus(job: JobStatusBadgeProps['job']): StatusInfo {
  if (!job.enabled) return { label: 'Disabled', color: 'gray' }
  if (job.running) return { label: 'Running', color: 'yellow' }
  if (job.lastError) return { label: 'Error', color: 'red' }
  // A run that started but never recorded completion (lastStartedAt newer than lastCompletedAt, or
  // no completion at all) while no process runs it: the process died mid-run (e.g. an OOM kill, which
  // writes nothing). The scheduler's next start records it as interrupted (an Error with the reason),
  // so this shows only until then.
  if (job.lastStartedAt && (!job.lastCompletedAt || job.lastStartedAt > job.lastCompletedAt)) {
    return { label: 'Incomplete', color: 'red', explanation: incompleteExplanation(job.lastStartedAt) }
  }
  if (job.lastCompletedAt) return { label: 'OK', color: 'green' }
  return { label: 'Never run', color: 'gray' }
}

function incompleteExplanation(startedAt: string): string {
  return (
    `Started ${formatDateWithTime(startedAt)} UTC and not finished, and no server is running it now: most likely the server stopped during the run. ` +
    'The next scheduler start records the reason here (or a few minutes after the start, when the restart was quick) and reruns the job if it is one of the pipeline steps from crawl to publish.'
  )
}

const dotColors = {
  yellow: 'bg-yellow-400 animate-pulse',
  red: 'bg-red-500',
  green: 'bg-green-500',
  gray: 'bg-neutral-300',
}

function Spinner() {
  return (
    <svg className="inline-block h-3.5 w-3.5 animate-spin text-yellow-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export function JobStatusBadge({ job, variant = 'badge' }: JobStatusBadgeProps) {
  const status = getStatus(job)

  if (variant === 'dot') {
    if (job.running) {
      return <Spinner />
    }
    const title = status.explanation ? `${status.label}: ${status.explanation}` : status.label
    return <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColors[status.color]}`} title={title} />
  }

  if (job.running) {
    return (
      <Badge variant="yellow" className="animate-pulse gap-1.5">
        <Spinner />
        Running
      </Badge>
    )
  }

  if (status.explanation) {
    // Focusable, so the explanation opens on keyboard focus as on hover (Tooltip)
    return (
      <Tooltip content={status.explanation}>
        {trigger => (
          <Badge
            variant={status.color}
            tabIndex={0}
            className="cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            {...trigger}
          >
            {status.label}
          </Badge>
        )}
      </Tooltip>
    )
  }

  return <Badge variant={status.color}>{status.label}</Badge>
}
