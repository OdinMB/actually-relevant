import { useState } from 'react'
import { ExclamationTriangleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import { PlayIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import type { JobRun } from '@shared/types'
import { jobDisplayName } from '../../lib/constants'
import { stepMode, stepModeUpdate, type StepMode } from '../../lib/jobRun'
import { useContinueChain, useJobChange, useRunJob } from '../../hooks/useJobs'
import { ApiError } from '../../lib/admin-api'
import { ActionIconButton } from '../ui/ActionIconButton'
import { Button } from '../ui/Button'
import { InfoTip } from '../ui/InfoTip'
import { useToast } from '../ui/Toast'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { TimeWithRelative } from './TimeWithRelative'
import { EnabledToggle, FlexToggle, LastRun, RunningSpinner } from './jobControls'
import { JobEditPanel } from './JobsTable'

const STEP_MODES: { value: StepMode; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'review', label: 'Review' },
  { value: 'off', label: 'Off' },
]

function StepModeSelect({ step }: { step: JobRun }) {
  const change = useJobChange(step)
  const name = jobDisplayName(step.jobName)
  return (
    <select
      value={stepMode(step)}
      aria-label={`Mode of ${name}`}
      disabled={change.pending}
      onChange={e => {
        const mode = e.target.value as StepMode
        change.save(stepModeUpdate(mode), `${name}: ${STEP_MODES.find(m => m.value === mode)!.label}`)
      }}
      className="rounded-md border border-neutral-300 bg-white py-1 pl-2 pr-7 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      {STEP_MODES.map(mode => (
        <option key={mode.value} value={mode.value}>
          {mode.label}
        </option>
      ))}
    </select>
  )
}

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
 * steps in order, each with its mode (On, Review, Off), its Flex switch and its own last run.
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

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th scope="col" className="px-3 py-2 text-left font-medium text-neutral-500">
                Step
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-neutral-500">
                Mode
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-neutral-500">
                Flex
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-neutral-500">
                Status
              </th>
              <th scope="col" className="hidden px-3 py-2 text-left font-medium text-neutral-500 lg:table-cell">
                Last Finished
              </th>
              <th scope="col" className="hidden px-3 py-2 text-left font-medium text-neutral-500 lg:table-cell">
                Last Run
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium text-neutral-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => {
              const stepName = jobDisplayName(step.jobName)
              return (
                <tr key={step.jobName} className={`border-b border-neutral-100 last:border-0 ${step.running ? 'bg-yellow-50' : 'hover:bg-neutral-50'}`}>
                  <td className="px-3 py-2 font-medium text-neutral-900">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-4 text-xs font-normal text-neutral-400">{i + 1}</span>
                      <button
                        onClick={() => setSelected(step.jobName)}
                        className="rounded text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {stepName}
                      </button>
                      {step.note && <InfoTip label={`About ${stepName}`}>{step.note}</InfoTip>}
                    </span>
                    {step.warning && (
                      <p className="ml-5 mt-0.5 flex max-w-xs items-start gap-1 text-xs font-normal text-amber-800">
                        <ExclamationTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {step.warning}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StepModeSelect step={step} />
                  </td>
                  <td className="px-3 py-2">
                    <FlexToggle job={step} />
                  </td>
                  <td className="px-3 py-2">
                    {/* A step that is off shows Disabled, the badge's word for a job that does not run */}
                    <JobStatusBadge job={step} />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-neutral-500 lg:table-cell">
                    <TimeWithRelative dateStr={step.lastCompletedAt} />
                  </td>
                  <td className="hidden px-3 py-2 text-neutral-500 lg:table-cell">
                    <LastRun job={step} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5">
                      <RunButton job={step} />
                      <ActionIconButton icon={PencilSquareIcon} label={`Details of ${stepName}`} onClick={() => setSelected(step.jobName)} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {panelJob && <JobEditPanel job={panelJob} onClose={() => setSelected(null)} />}
    </section>
  )
}
