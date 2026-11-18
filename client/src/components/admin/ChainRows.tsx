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
import { FullWidthRow, JobRow, WIDE } from './jobTable'

/** "HH:MM UTC" of an ISO time. */
const utcClock = (iso: string) => `${iso.slice(11, 16)} UTC`

/** What the chain is waiting on, in a row across the table under it: a review, a step's time, or a person after a failed step. */
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
    <FullWidthRow>
      <div
        className={`flex flex-wrap items-center gap-3 border-b py-2 pl-8 pr-3 text-sm ${failed ? 'border-red-200 bg-red-50 text-red-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}
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
    </FullWidthRow>
  )
}

/**
 * The chain's own row, heading its group: its name (and note), schedule (click to edit), switch, flex
 * cut-off in hours, status, the whole run's length and cost (what each step did is in its own row),
 * when it last finished, and Run and Details for the whole chain. Review stays empty: only a step
 * waits for review.
 */
function ChainRow({ chain, onOpen }: { chain: JobRun; onOpen: (jobName: string) => void }) {
  const name = jobDisplayName(chain.jobName)
  return (
    <tr className={`border-y border-neutral-200 ${chain.running ? 'bg-yellow-50' : 'bg-neutral-100'}`}>
      <th scope="row" id={`${chain.jobName}-title`} className="px-3 py-2 text-left font-semibold text-neutral-900">
        <span className="inline-flex items-center gap-1">
          {name}
          {chain.note && <InfoTip label={`About ${name}`}>{chain.note}</InfoTip>}
        </span>
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
 * A chain in the Jobs page's table: its own row, what it is waiting on (if anything), then its steps
 * in order, indented under it.
 */
export function ChainRows({ chain, steps, onOpen }: { chain: JobRun; steps: JobRun[]; onOpen: (jobName: string) => void }) {
  return (
    <tbody aria-labelledby={`${chain.jobName}-title`}>
      <ChainRow chain={chain} onOpen={onOpen} />
      <ChainState chain={chain} />
      {steps.map((step, i) => (
        <JobRow key={step.jobName} job={step} step={i + 1} onOpen={onOpen} />
      ))}
    </tbody>
  )
}
