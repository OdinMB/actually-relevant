import { useState } from 'react'
import { ExclamationTriangleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import { PlayIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import type { JobRun } from '@shared/types'
import { jobDisplayName } from '../../lib/constants'
import { useContinueChain, useJobChange, useRunJob } from '../../hooks/useJobs'
import { ApiError } from '../../lib/admin-api'
import { ActionIconButton } from '../ui/ActionIconButton'
import { Button } from '../ui/Button'
import { InfoTip } from '../ui/InfoTip'
import { useToast } from '../ui/Toast'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { TimeWithRelative } from './TimeWithRelative'
import { EnabledToggle, LastRun, RunningSpinner } from './jobControls'
import { JobEditPanel } from './JobsTable'
import { JobRow, JobTable } from './jobTable'

/** A chain's flex cut-off or deadline: a time of day in UTC, or empty for none. Saved when it changes. */
function ClockTimeField({ chain, field, label, help }: { chain: JobRun; field: 'flexUntil' | 'deadline'; label: string; help: string }) {
  const change = useJobChange(chain)
  const id = `${chain.jobName}-${field}`
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-neutral-600">
        {label} <span className="font-normal text-neutral-400">(UTC)</span>
      </label>
      <input
        id={id}
        type="time"
        defaultValue={chain[field] ?? ''}
        key={chain[field] ?? ''}
        aria-describedby={`${id}-help`}
        onBlur={e => {
          const value = e.target.value || null
          if (value !== chain[field]) change.save({ [field]: value }, `${jobDisplayName(chain.jobName)}: ${label.toLowerCase()} ${value ?? 'removed'}`)
        }}
        className="mt-0.5 rounded-md border border-neutral-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <p id={`${id}-help`} className="mt-0.5 max-w-[14rem] text-xs text-neutral-500">
        {help}
      </p>
    </div>
  )
}

/** What the chain is waiting on, in view: a review, or a person after a failed step. */
function ChainState({ chain }: { chain: JobRun }) {
  const continueChain = useContinueChain()
  const { toast } = useToast()
  if (!chain.canContinue || !chain.resumeStep || chain.running) return null
  const step = jobDisplayName(chain.resumeStep)
  const review = chain.resumeReason === 'review'
  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${review ? 'border-sky-200 bg-sky-50 text-sky-900' : 'border-red-200 bg-red-50 text-red-900'}`}
      role="status"
    >
      {review ? (
        <PauseCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{review ? `Waiting for review. ${step} runs next.` : `Stopped at ${step}. The steps after it did not run.`}</span>
      <Button
        size="sm"
        variant={review ? 'primary' : 'secondary'}
        disabled={continueChain.isPending}
        onClick={() =>
          continueChain.mutate(chain.jobName, {
            onSuccess: () => toast('success', `${jobDisplayName(chain.jobName)} continues with ${step}`),
            onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to continue the chain'),
          })
        }
      >
        {review ? `Continue with ${step}` : `Resume from ${step}`}
      </Button>
    </div>
  )
}

function RunButton({ job }: { job: JobRun }) {
  const runJob = useRunJob()
  const { toast } = useToast()
  if (job.running) {
    return (
      <span className="inline-block p-1">
        <RunningSpinner />
      </span>
    )
  }
  return (
    <ActionIconButton
      icon={PlayIcon}
      label={`Run ${jobDisplayName(job.jobName)}`}
      disabled={runJob.isPending}
      onClick={() =>
        runJob.mutate(job.jobName, {
          onSuccess: () => toast('success', `${jobDisplayName(job.jobName)} triggered`),
          // 409 when a run is already under way: the server's answer says so.
          onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to trigger job'),
        })
      }
    />
  )
}

/**
 * A chain on the Jobs page: its schedule, switch, flex cut-off and deadline and its last run, then its
 * steps in order in the Jobs page's shared table layout, each with its mode (On, Review, Off).
 */
export function ChainCard({ chain, steps }: { chain: JobRun; steps: JobRun[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const panelJob = [chain, ...steps].find(j => j.jobName === selected)
  const name = jobDisplayName(chain.jobName)

  return (
    <section aria-labelledby={`${chain.jobName}-title`} className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className={`flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-neutral-200 px-4 py-3 ${chain.running ? 'bg-yellow-50' : 'bg-neutral-50'}`}>
        <div className="min-w-[12rem] flex-1">
          <h2 id={`${chain.jobName}-title`} className="flex items-center gap-1 text-base font-semibold text-neutral-900">
            {name}
            {chain.note && <InfoTip label={`About ${name}`}>{chain.note}</InfoTip>}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
            <JobStatusBadge job={chain} />
            <EnabledToggle job={chain} />
            <CronEditor job={chain} />
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
            <div className="flex gap-1">
              <dt className="text-neutral-500">Last started</dt>
              <dd>
                <TimeWithRelative dateStr={chain.lastStartedAt} />
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-neutral-500">Last run</dt>
              <dd>
                <LastRun job={chain} />
              </dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <ClockTimeField chain={chain} field="flexUntil" label="Flex until" help="From this time on, AI calls go at standard price." />
          {/* Only research works through items against the deadline, so only its chain offers one */}
          {chain.steps?.includes('research_stories') && (
            <ClockTimeField chain={chain} field="deadline" label="Done by" help="From this time on, research starts no other story." />
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <RunButton job={chain} />
          <ActionIconButton icon={PencilSquareIcon} label={`Details of ${name}`} onClick={() => setSelected(chain.jobName)} />
        </div>
      </div>

      <ChainState chain={chain} />

      <JobTable>
        {steps.map((step, i) => (
          <JobRow key={step.jobName} job={step} step={i + 1} onOpen={setSelected} />
        ))}
      </JobTable>

      {panelJob && <JobEditPanel job={panelJob} onClose={() => setSelected(null)} />}
    </section>
  )
}
