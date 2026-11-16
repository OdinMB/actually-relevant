import type { JobRun } from '@shared/types'
import { jobDisplayName } from '../../lib/constants'
import { formatDuration, formatUsd, lastRunDurationMs, usageDetails } from '../../lib/jobRun'
import { useJobChange } from '../../hooks/useJobs'
import { Tooltip } from '../ui/Tooltip'

export function RunningSpinner({ size = 'h-5 w-5' }: { size?: string }) {
  return (
    <svg className={`${size} animate-spin text-yellow-600`} viewBox="0 0 24 24" fill="none" aria-label="Running">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 ${
        on ? 'bg-brand-600' : 'bg-neutral-300'
      }`}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-1'}`} />
    </button>
  )
}

export function EnabledToggle({ job }: { job: JobRun }) {
  const change = useJobChange(job)
  const name = jobDisplayName(job.jobName)
  return (
    <Switch
      on={job.enabled}
      label={`${job.enabled ? 'Disable' : 'Enable'} ${name}`}
      onToggle={() => change.save({ enabled: !job.enabled }, `${name} ${!job.enabled ? 'enabled' : 'disabled'}`)}
    />
  )
}

/** The job's Flex switch: model calls at half price, slower, falling back to standard when OpenAI is busy. */
export function FlexToggle({ job }: { job: JobRun }) {
  const change = useJobChange(job)
  const name = jobDisplayName(job.jobName)
  if (!job.usesModels) return <span className="text-neutral-400">—</span>
  return (
    <Switch
      on={job.flex}
      label={`${job.flex ? 'Stop using' : 'Use'} flex processing for ${name}`}
      onToggle={() => change.save({ flex: !job.flex }, `${name}: ${!job.flex ? 'flex processing on' : 'standard processing'}`)}
    />
  )
}

/** The last finished run's length and cost, the cost explained on hover and keyboard focus. */
export function LastRun({ job }: { job: JobRun }) {
  const duration = lastRunDurationMs(job)
  const usage = job.lastRunUsage
  if (duration === null && !usage) return <span className="text-neutral-400">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {duration !== null && <span>{formatDuration(duration)}</span>}
      {usage && (
        <Tooltip content={usageDetails(usage)} align="end">
          {trigger => (
            <button
              type="button"
              {...trigger}
              className="rounded font-medium text-neutral-700 underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {formatUsd(usage.costUsd)}
            </button>
          )}
        </Tooltip>
      )}
    </span>
  )
}
