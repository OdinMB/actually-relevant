import { EllipsisVerticalIcon, PlayIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import type { JobRun } from '@shared/types'
import { ActionIconButton } from '../ui/ActionIconButton'
import { InfoTip } from '../ui/InfoTip'
import { useToast } from '../ui/Toast'
import { jobDisplayName } from '../../lib/constants'
import { stepMode, stepModeUpdate, type StepMode } from '../../lib/jobRun'
import { useJobChange, useRunJob } from '../../hooks/useJobs'
import { ApiError } from '../../lib/admin-api'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { TimeWithRelative } from './TimeWithRelative'
import { EnabledToggle, FlexToggle, LastRun, RunningSpinner } from './jobControls'

/**
 * The one column layout of every jobs table on the Jobs page: the chains' step tables and the table of
 * other jobs share it, with fixed widths, so their columns line up down the page.
 */
// Start time, last success and the full error are in the details panel: the table keeps what fits a laptop.
const COLUMNS: { label: string; width: string; wide?: boolean; right?: boolean }[] = [
  { label: 'Job', width: 'w-[24%]' },
  { label: 'Schedule', width: 'w-[17%]', wide: true },
  { label: 'Enabled', width: 'w-[11%]' },
  { label: 'Flex', width: 'w-[7%]' },
  { label: 'Status', width: 'w-[10%]' },
  { label: 'Last Run', width: 'w-[12%]', wide: true },
  { label: 'Last Finished', width: 'w-[12%]', wide: true },
  { label: 'Actions', width: 'w-[7%]', right: true },
]

const WIDE = 'hidden lg:table-cell'

export function JobTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          {COLUMNS.map(col => (
            <col key={col.label} className={`${col.width} ${col.wide ? 'hidden lg:table-column' : ''}`} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            {COLUMNS.map(col => (
              <th
                key={col.label}
                scope="col"
                className={`px-3 py-2 font-medium text-neutral-500 ${col.right ? 'text-right' : 'text-left'} ${col.wide ? WIDE : ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

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

/**
 * One job in a jobs table. A chain's step (given its place in the chain) shows that place instead of a
 * schedule, and its mode (On, Review, Off) instead of the Enabled switch.
 */
export function JobRow({ job, step, onOpen }: { job: JobRun; step?: number; onOpen: (jobName: string) => void }) {
  const runJob = useRunJob()
  const { toast } = useToast()
  const name = jobDisplayName(job.jobName)
  const run = () =>
    runJob.mutate(job.jobName, {
      onSuccess: () => toast('success', `${name} triggered`),
      // 409 when a run is already under way: the server's answer says so.
      onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to trigger job'),
    })

  return (
    <tr className={`border-b border-neutral-100 last:border-0 ${job.running ? 'bg-yellow-50' : 'hover:bg-neutral-50'}`}>
      <td className="px-3 py-2 font-medium text-neutral-900">
        <span className="inline-flex items-center gap-1">
          <button
            onClick={() => onOpen(job.jobName)}
            className="rounded text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {name}
          </button>
          {job.note && <InfoTip label={`About ${name}`}>{job.note}</InfoTip>}
        </span>
        {/* A state the owner must notice stays in view; the explanation is behind the icon */}
        {job.warning && (
          <p className="mt-0.5 flex items-start gap-1 text-xs font-normal text-amber-800">
            <ExclamationTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {job.warning}
          </p>
        )}
      </td>
      <td className={`px-3 py-2 ${WIDE}`}>
        {step === undefined ? (
          <CronEditor job={job} />
        ) : (
          <span className="text-neutral-500">
            Step {step} of the chain
            {job.notBefore && <span className="block text-xs">not before {job.notBefore} UTC</span>}
          </span>
        )}
      </td>
      <td className="px-3 py-2">{step === undefined ? <EnabledToggle job={job} /> : <StepModeSelect step={job} />}</td>
      <td className="px-3 py-2">
        <FlexToggle job={job} />
      </td>
      <td className="px-3 py-2">
        {/* A step that is off shows Disabled, the badge's word for a job that does not run */}
        <JobStatusBadge job={job} />
        {job.lastError && (
          <button
            onClick={() => onOpen(job.jobName)}
            className="mt-0.5 block rounded text-left text-xs text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            View error
          </button>
        )}
      </td>
      <td className={`px-3 py-2 text-neutral-500 ${WIDE}`}>
        <LastRun job={job} />
      </td>
      <td className={`px-3 py-2 text-neutral-500 ${WIDE}`}>
        <TimeWithRelative dateStr={job.lastCompletedAt} />
      </td>
      <td className="px-3 py-2">
        {/* Desktop actions */}
        <div className="hidden items-center justify-end gap-0.5 lg:flex">
          {job.running ? (
            <span className="inline-block p-1">
              <RunningSpinner />
            </span>
          ) : (
            <ActionIconButton icon={PlayIcon} label={`Run ${name}`} onClick={run} disabled={runJob.isPending} />
          )}
          <ActionIconButton icon={PencilSquareIcon} label={`Details of ${name}`} onClick={() => onOpen(job.jobName)} />
        </div>

        {/* Mobile overflow menu */}
        <div className="flex justify-end lg:hidden">
          <Menu as="div" className="relative">
            <MenuButton
              aria-label={`Actions for ${name}`}
              className="rounded p-1 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <EllipsisVerticalIcon className="h-5 w-5 text-neutral-400" />
            </MenuButton>
            <MenuItems className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-neutral-200 bg-white py-1 shadow-lg focus:outline-none">
              <MenuItem>
                {job.running ? (
                  <div className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-yellow-700">
                    <RunningSpinner size="h-4 w-4" />
                    Running...
                  </div>
                ) : (
                  <button
                    onClick={run}
                    disabled={runJob.isPending}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 data-[focus]:bg-neutral-100 disabled:opacity-50"
                  >
                    <PlayIcon className="h-4 w-4 shrink-0" />
                    Run
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                <button
                  onClick={() => onOpen(job.jobName)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 data-[focus]:bg-neutral-100"
                >
                  <PencilSquareIcon className="h-4 w-4 shrink-0" />
                  Details
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        </div>
      </td>
    </tr>
  )
}
