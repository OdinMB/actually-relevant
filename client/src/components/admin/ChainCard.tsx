import { useState } from 'react'
import { ClockIcon, ExclamationTriangleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import { PencilSquareIcon } from '@heroicons/react/24/outline'
import type { JobRun } from '@shared/types'
import { jobDisplayName } from '../../lib/constants'
import { useContinueChain } from '../../hooks/useJobs'
import { ApiError } from '../../lib/admin-api'
import { ActionIconButton } from '../ui/ActionIconButton'
import { Button } from '../ui/Button'
import { InfoTip } from '../ui/InfoTip'
import { useToast } from '../ui/Toast'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { TimeWithRelative } from './TimeWithRelative'
import { FlexHoursField, EnabledToggle, LastRun, RunButton } from './jobControls'
import { JobEditPanel } from './JobsTable'
import { JobRow, JobTable, WIDE } from './jobTable'

/** "HH:MM UTC" of an ISO time. */
const utcClock = (iso: string) => `${iso.slice(11, 16)} UTC`

/** What the chain is waiting on, in view: a review, a step's time, or a person after a failed step. */
function ChainState({ chain }: { chain: JobRun }) {
  const continueChain = useContinueChain()
  const { toast } = useToast()
  if (!chain.canContinue || !chain.resumeStep || chain.running) return null
  const step = jobDisplayName(chain.resumeStep)
  const reason = chain.resumeReason
  const failed = reason === 'failed'
  const message =
    reason === 'review'
      ? `Waiting for review. ${step} runs next.`
      : reason === 'waiting'
        ? `${step} runs at ${chain.resumeAt ? utcClock(chain.resumeAt) : 'its set time'}.`
        : `Stopped at ${step}. The steps after it did not run.`
  const action = reason === 'review' ? `Continue with ${step}` : reason === 'waiting' ? `Run ${step} now` : `Resume from ${step}`
  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${failed ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
      role="status"
    >
      {failed ? (
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : reason === 'waiting' ? (
        <ClockIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <PauseCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{message}</span>
      <Button
        size="sm"
        variant={reason === 'review' ? 'primary' : 'secondary'}
        disabled={continueChain.isPending}
        onClick={() =>
          continueChain.mutate(chain.jobName, {
            onSuccess: () => toast('success', `${jobDisplayName(chain.jobName)} continues with ${step}`),
            onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to continue the chain'),
          })
        }
      >
        {action}
      </Button>
    </div>
  )
}

/**
 * The chain itself, above its steps in the same columns: its schedule (click to edit), switch, flex
 * cut-off in hours, status, the whole run's length and cost (what each step did is in its own row),
 * when it last finished, and Run and Details for the whole chain. Review stays empty: only a step
 * waits for review.
 */
function ChainTotalRow({ chain, onOpen }: { chain: JobRun; onOpen: (jobName: string) => void }) {
  const name = jobDisplayName(chain.jobName)
  return (
    <tr className={`border-b-2 border-neutral-200 ${chain.running ? 'bg-yellow-50' : 'bg-neutral-50'}`}>
      <th scope="row" className="px-3 py-2 text-left font-semibold text-neutral-900">
        Whole chain
        {/* The Schedule column shows from lg on; below it the schedule goes here, on one line */}
        <span className="mt-0.5 block font-normal lg:hidden">
          <CronEditor job={chain} compact />
        </span>
      </th>
      <td className={`px-3 py-2 ${WIDE}`}>
        <CronEditor job={chain} />
      </td>
      <td className="px-3 py-2">
        <EnabledToggle job={chain} />
      </td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2">
        <FlexHoursField job={chain} />
      </td>
      <td className="px-3 py-2">
        <JobStatusBadge job={chain} />
      </td>
      <td className={`px-3 py-2 font-medium text-neutral-700 ${WIDE}`}>
        <LastRun job={chain} summary={false} />
      </td>
      <td className={`px-3 py-2 text-neutral-700 ${WIDE}`}>
        <TimeWithRelative dateStr={chain.lastCompletedAt} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <RunButton job={chain} />
          <ActionIconButton icon={PencilSquareIcon} label={`Details of ${name}`} onClick={() => onOpen(chain.jobName)} />
        </div>
      </td>
    </tr>
  )
}

/**
 * A chain on the Jobs page: its name, then the chain itself in a Whole chain row and its steps in
 * order under it, in the Jobs page's shared table layout.
 */
export function ChainCard({ chain, steps }: { chain: JobRun; steps: JobRun[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const panelJob = [chain, ...steps].find(j => j.jobName === selected)
  const name = jobDisplayName(chain.jobName)

  return (
    <section aria-labelledby={`${chain.jobName}-title`} className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-neutral-200 px-4 py-3 ${chain.running ? 'bg-yellow-50' : 'bg-neutral-50'}`}>
        <h2 id={`${chain.jobName}-title`} className="flex min-w-[12rem] flex-1 items-center gap-1 text-base font-semibold text-neutral-900">
          {name}
          {chain.note && <InfoTip label={`About ${name}`}>{chain.note}</InfoTip>}
        </h2>
      </div>

      <ChainState chain={chain} />

      <JobTable>
        <ChainTotalRow chain={chain} onOpen={setSelected} />
        {steps.map((step, i) => (
          <JobRow key={step.jobName} job={step} step={i + 1} onOpen={setSelected} />
        ))}
      </JobTable>

      {panelJob && <JobEditPanel job={panelJob} onClose={() => setSelected(null)} />}
    </section>
  )
}
