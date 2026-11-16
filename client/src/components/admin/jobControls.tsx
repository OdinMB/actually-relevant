import type { JobRun } from '@shared/types'
import { jobDisplayName } from '../../lib/constants'
import { formatDuration, formatUsd, lastRunDurationMs, usageDetails } from '../../lib/jobRun'
import { PlayIcon } from '@heroicons/react/24/outline'
import { useJobChange, useRunJob } from '../../hooks/useJobs'
import { ApiError } from '../../lib/admin-api'
import { ActionIconButton } from '../ui/ActionIconButton'
import { Tooltip } from '../ui/Tooltip'
import { useToast } from '../ui/Toast'

/**
 * A time of day in UTC, or empty for none, saved when it changes: a chain's flex cut-off or deadline.
 */
export function ClockTimeField({ job, field, label, help }: { job: JobRun; field: 'flexUntil' | 'deadline'; label: string; help: string }) {
  const change = useJobChange(job)
  const id = `${job.jobName}-${field}`
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-neutral-600">
        {label} <span className="font-normal text-neutral-400">(UTC)</span>
      </label>
      <input
        id={id}
        type="time"
        defaultValue={job[field] ?? ''}
        key={job[field] ?? ''}
        aria-describedby={`${id}-help`}
        onBlur={e => {
          const value = e.target.value || null
          if (value !== job[field]) change.save({ [field]: value }, `${jobDisplayName(job.jobName)}: ${label.toLowerCase()} ${value ?? 'removed'}`)
        }}
        className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <p id={`${id}-help`} className="mt-0.5 max-w-[14rem] text-xs text-neutral-500">
        {help}
      </p>
    </div>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** The clock a step's times are read on: its own zone's city, or UTC. */
export const clockName = (job: Pick<JobRun, 'timeZone'>) => (job.timeZone ? (job.timeZone.split('/').pop() ?? job.timeZone).replace(/_/g, ' ') : 'UTC')

/**
 * A chain step's "not before" time: a weekday (or any day) and a time of day on the step's own clock,
 * or none. The chain holds before the step until then. Saved when either part changes.
 */
export function NotBeforeField({ job }: { job: JobRun }) {
  const change = useJobChange(job)
  const name = jobDisplayName(job.jobName)
  const match = /^(?:(\w{3}) )?(\d\d:\d\d)$/.exec(job.notBefore ?? '')
  const day = match?.[1] ?? ''
  const time = match?.[2] ?? ''
  const save = (nextDay: string, nextTime: string) => {
    const value = nextTime ? `${nextDay ? `${nextDay} ` : ''}${nextTime}` : null
    if (value !== job.notBefore) change.save({ notBefore: value }, `${name}: ${value ? `not before ${value}` : 'no hold'}`)
  }
  const id = `${job.jobName}-notBefore`
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700 mb-1">
        Not before <span className="font-normal text-neutral-400">({clockName(job)})</span>
      </label>
      <div className="flex gap-2">
        <select
          aria-label={`Day for ${name}`}
          value={day}
          disabled={!time}
          onChange={e => save(e.target.value, time)}
          className="rounded-md border border-neutral-300 bg-white py-1 pl-2 pr-7 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Any day</option>
          {WEEKDAYS.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          id={id}
          type="time"
          defaultValue={time}
          key={time}
          aria-describedby={`${id}-help`}
          onBlur={e => save(day, e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <p id={`${id}-help`} className="mt-1 text-xs text-neutral-500">
        The chain waits before this step until this time comes round after the chain starts. Empty to run straight on.
      </p>
    </div>
  )
}

export function RunningSpinner({ size = 'h-5 w-5' }: { size?: string }) {
  return (
    <svg className={`${size} animate-spin text-yellow-600`} viewBox="0 0 24 24" fill="none" aria-label="Running">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

/** Run a job now, with a toast for the outcome; 409 when a run is already under way, which the server's answer says. */
export function useRunJobNow(job: JobRun) {
  const runJob = useRunJob()
  const { toast } = useToast()
  const name = jobDisplayName(job.jobName)
  const run = () =>
    runJob.mutate(job.jobName, {
      onSuccess: () => toast('success', `${name} triggered`),
      onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to trigger job'),
    })
  return { run, pending: runJob.isPending }
}

/** The Run button, or a spinner while the job runs. */
export function RunButton({ job }: { job: JobRun }) {
  const { run, pending } = useRunJobNow(job)
  if (job.running) {
    return (
      <span className="inline-block p-1">
        <RunningSpinner />
      </span>
    )
  }
  return <ActionIconButton icon={PlayIcon} label={`Run ${jobDisplayName(job.jobName)}`} onClick={run} disabled={pending} />
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

/** A chain step's Review switch: after the step, the chain waits for a person; a dash for other jobs. */
export function ReviewToggle({ job }: { job: JobRun }) {
  const change = useJobChange(job)
  const name = jobDisplayName(job.jobName)
  if (!job.chain) return <span className="text-neutral-400">—</span>
  return (
    <Switch
      on={job.pauseForReview}
      label={`${job.pauseForReview ? 'Stop waiting for review after' : 'Wait for review after'} ${name}`}
      onToggle={() =>
        change.save({ pauseForReview: !job.pauseForReview }, `${name}: ${!job.pauseForReview ? 'the chain waits for review after it' : 'no review'}`)
      }
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

/** The last finished run's length, cost (explained on hover and keyboard focus) and what it did. */
export function LastRun({ job }: { job: JobRun }) {
  const duration = lastRunDurationMs(job)
  const usage = job.lastRunUsage
  if (duration === null && !usage) return <span className="text-neutral-400">—</span>
  return (
    <span className="inline-flex flex-col gap-0.5">
      <LastRunCost duration={duration} usage={usage} />
      {job.lastRunSummary && <span className="text-xs text-neutral-500">{job.lastRunSummary}</span>}
    </span>
  )
}

function LastRunCost({ duration, usage }: { duration: number | null; usage: JobRun['lastRunUsage'] }) {
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
