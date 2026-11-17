import { EllipsisVerticalIcon, PlayIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import type { JobRun } from '@shared/types'
import { ActionIconButton } from '../ui/ActionIconButton'
import { InfoTip } from '../ui/InfoTip'
import { byPipelineOrder, jobDisplayName } from '../../lib/constants'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { TimeWithRelative } from './TimeWithRelative'
import { clockName, EnabledToggle, FlexToggle, LastRun, ReviewToggle, RunButton, RunningSpinner, useRunJobNow } from './jobControls'

/**
 * The one column layout of every jobs table on the Jobs page: the chains' step tables and the table of
 * other jobs share it, with fixed widths, so their columns line up down the page.
 */
// Start time, last success and the full error are in the details panel: the table keeps what fits a laptop.
// The widths hold from lg on, where every column shows and the tables line up down the page. Below lg the
// table sizes its columns to their content and scrolls sideways when it does not fit, so nothing overlaps.
const COLUMNS: { label: string; width: string; wide?: boolean; right?: boolean; note?: string }[] = [
  { label: 'Job', width: 'lg:w-[22%]' },
  { label: 'Schedule', width: 'lg:w-[16%]', wide: true },
  { label: 'Enabled', width: 'lg:w-[7%]' },
  {
    label: 'Review',
    width: 'lg:w-[7%]',
    note: 'For a step of a chain: after this step, the chain waits until a person continues it from the chain’s header.',
  },
  {
    label: 'Flex',
    width: 'lg:w-[8%]',
    note: 'A job’s switch: its AI calls go at half price through OpenAI’s flex processing, which is slower and falls back to standard price when OpenAI is busy. A chain’s own row (the one with its name) has hours instead: once that many hours have passed since the run started, every call in the chain goes at standard price, so a slow flex queue cannot hold up the chain for long. Empty: flex for the whole run.',
  },
  { label: 'Status', width: 'lg:w-[10%]' },
  { label: 'Last Run', width: 'lg:w-[12%]', wide: true },
  { label: 'Last Finished', width: 'lg:w-[12%]', wide: true },
  { label: 'Actions', width: 'lg:w-[7%]', right: true },
]

/** A cell of a column shown from lg on only (Schedule, Last Run, Last Finished). */
export const WIDE = 'hidden lg:table-cell'

/**
 * The Jobs page's one table: the column headers once, sticking to the top of the page as it scrolls
 * (from lg on; below lg the table scrolls sideways, which a sticky header cannot follow), and every
 * group of rows under them, each its own `<tbody>`.
 */
export function JobTable({ children }: { children: React.ReactNode }) {
  return (
    // overflow-clip, not overflow-hidden, rounds the corners without making a scroll box the header would stick to
    <div className="overflow-clip rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="overflow-x-auto lg:overflow-visible">
        <table className="w-full text-sm lg:table-fixed">
          <colgroup>
            {COLUMNS.map(col => (
              <col key={col.label} className={`${col.width} ${col.wide ? 'hidden lg:table-column' : ''}`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.label}
                  scope="col"
                  // The shadow is the header's bottom line: a sticky cell's border scrolls away with the table.
                  // -top-6 takes back the admin page's lg:p-6, so the header sticks flush with the top edge
                  className={`whitespace-nowrap bg-neutral-50 px-3 py-2 font-medium text-neutral-500 shadow-[inset_0_-1px_0_theme(colors.neutral.200)] lg:sticky lg:-top-6 lg:z-10 ${col.right ? 'text-right' : 'text-left'} ${col.wide ? WIDE : ''}`}
                >
                  {col.note ? (
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      <InfoTip label={`About ${col.label}`}>{col.note}</InfoTip>
                    </span>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </div>
  )
}

/** A heading row across the whole table, for a group of rows with no row of its own (Other jobs). */
export function GroupHeadingRow({ id, title }: { id: string; title: string }) {
  return (
    <tr className="border-y border-neutral-200 bg-neutral-100">
      <th id={id} scope="colgroup" colSpan={COLUMNS.length} className="px-3 py-2 text-left font-semibold text-neutral-900">
        {title}
      </th>
    </tr>
  )
}

/**
 * The jobs that run on their own schedules, in pipeline order: under an Other jobs heading when chains
 * come before them.
 */
export function OtherJobRows({ jobs, heading, onOpen }: { jobs: JobRun[]; heading: boolean; onOpen: (jobName: string) => void }) {
  return (
    <tbody aria-labelledby={heading ? 'other-jobs-title' : undefined}>
      {heading && <GroupHeadingRow id="other-jobs-title" title="Other jobs" />}
      {[...jobs].sort(byPipelineOrder).map(job => (
        <JobRow key={job.jobName} job={job} onOpen={onOpen} />
      ))}
    </tbody>
  )
}

/** A row across the whole table under a group's first row: what a chain is waiting on. */
export function FullWidthRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={COLUMNS.length} className="p-0">
        {children}
      </td>
    </tr>
  )
}

/**
 * One job in a jobs table. A chain's step (given its place in the chain) shows that place instead of a
 * schedule; a step that is not enabled is skipped, and Review makes the chain wait for a person after it.
 */
export function JobRow({ job, step, onOpen }: { job: JobRun; step?: number; onOpen: (jobName: string) => void }) {
  const { run, pending } = useRunJobNow(job)
  const name = jobDisplayName(job.jobName)

  return (
    <tr className={`border-b border-neutral-100 ${job.running ? 'bg-yellow-50' : 'hover:bg-neutral-50'}`}>
      {/* Indented under its group's row: the chain, or the Other jobs heading */}
      <td className="py-2 pl-8 pr-3 font-medium text-neutral-900">
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
            {job.notBefore && (
              <span className="block text-xs">
                not before {job.notBefore} {clockName(job)}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <EnabledToggle job={job} />
      </td>
      <td className="px-3 py-2">
        <ReviewToggle job={job} />
      </td>
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
          <RunButton job={job} />
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
                    disabled={pending}
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
