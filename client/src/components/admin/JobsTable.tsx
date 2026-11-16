import { useState } from 'react'
import type { JobRun } from '@shared/types'
import { Button } from '../ui/Button'
import { jobDisplayName, JOB_PIPELINE_ORDER } from '../../lib/constants'
import { TimeWithRelative } from './TimeWithRelative'
import { EnabledToggle, FlexToggle, LastRun } from './jobControls'
import { JobRow, JobTable } from './jobTable'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { EditPanel, PANEL_BODY, PANEL_FOOTER } from './EditPanel'

interface JobsTableProps {
  jobs: JobRun[]
}

export function JobEditPanel({ job, onClose }: { job: JobRun; onClose: () => void }) {
  return (
    <EditPanel open onClose={onClose} title={jobDisplayName(job.jobName)}>
      <div className={PANEL_BODY}>
        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
          <JobStatusBadge job={job} />
        </div>

        {/* Enabled toggle; a chain's step has its mode on its chain's card instead */}
        {!job.chain && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Enabled</label>
            <EnabledToggle job={job} />
          </div>
        )}

        {job.usesModels && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Flex processing</label>
            <FlexToggle job={job} />
            <p className="mt-1 text-xs text-neutral-500">Half price for AI calls, but slower. When OpenAI is busy, calls go at standard price.</p>
          </div>
        )}

        {/* Schedule (opens in edit mode directly); a chain's step runs when its chain reaches it */}
        {!job.chain && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Schedule</label>
            <CronEditor job={job} initialEditing />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Last Run</label>
          <p className="text-sm text-neutral-600">
            <LastRun job={job} />
          </p>
        </div>

        {/* Last Started */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Last Started</label>
          <p className="text-sm text-neutral-600">
            <TimeWithRelative dateStr={job.lastStartedAt} />
          </p>
        </div>

        {/* Last Finished (success or failure) */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Last Finished</label>
          <p className="text-sm text-neutral-600">
            <TimeWithRelative dateStr={job.lastCompletedAt} />
          </p>
        </div>

        {/* Last Success */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Last Success</label>
          <p className="text-sm text-neutral-600">
            <TimeWithRelative dateStr={job.lastSucceededAt} />
          </p>
        </div>

        {/* Error */}
        {job.lastError && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Last Error</label>
            <pre className="text-xs text-red-600 whitespace-pre-wrap break-words bg-red-50 rounded p-3 border border-red-200 max-h-64 overflow-y-auto font-mono">
              {job.lastError}
            </pre>
          </div>
        )}
      </div>

      <div className={PANEL_FOOTER}>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </EditPanel>
  )
}

/** The jobs that run on their own schedules, in pipeline order, in the Jobs page's shared table layout. */
export function JobsTable({ jobs }: JobsTableProps) {
  const [selectedJob, setSelectedJob] = useState<string | null>(null)

  const sortedJobs = [...jobs].sort((a, b) => {
    const ai = JOB_PIPELINE_ORDER.indexOf(a.jobName)
    const bi = JOB_PIPELINE_ORDER.indexOf(b.jobName)
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
  })

  const panelJob = jobs.find(j => j.jobName === selectedJob)

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <JobTable>
          {sortedJobs.map(job => (
            <JobRow key={job.jobName} job={job} onOpen={setSelectedJob} />
          ))}
        </JobTable>
      </div>

      {panelJob && <JobEditPanel job={panelJob} onClose={() => setSelectedJob(null)} />}
    </>
  )
}
