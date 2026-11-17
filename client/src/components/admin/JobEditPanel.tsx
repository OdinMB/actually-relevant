import type { JobRun } from '@shared/types'
import { Button } from '../ui/Button'
import { jobDisplayName } from '../../lib/constants'
import { TimeWithRelative } from './TimeWithRelative'
import { EnabledToggle, FlexToggle, LastRun, NotBeforeField, ReviewToggle } from './jobControls'
import { CronEditor } from './CronEditor'
import { JobStatusBadge } from './JobStatusBadge'
import { EditPanel, PANEL_BODY, PANEL_FOOTER } from './EditPanel'

/** A job's details panel on the Jobs page: its switches, schedule or hold time, and its last runs. */
export function JobEditPanel({ job, onClose }: { job: JobRun; onClose: () => void }) {
  return (
    <EditPanel open onClose={onClose} title={jobDisplayName(job.jobName)}>
      <div className={PANEL_BODY}>
        {/* Status */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Status</label>
          <JobStatusBadge job={job} />
        </div>

        {/* Enabled; a chain's step that is not enabled is skipped */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Enabled</label>
          <EnabledToggle job={job} />
        </div>

        {job.chain && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Review</label>
            <ReviewToggle job={job} />
            <p className="mt-1 text-xs text-neutral-500">After this step, the chain waits until someone continues it on this page.</p>
          </div>
        )}

        {job.usesModels && (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Flex processing</label>
            <FlexToggle job={job} />
            <p className="mt-1 text-xs text-neutral-500">Half price for AI calls, but slower. When OpenAI is busy, calls go at standard price.</p>
          </div>
        )}

        {/* Schedule (opens in edit mode directly); a chain's step runs when its chain reaches it, held until its time if it has one */}
        {job.chain ? (
          <NotBeforeField job={job} />
        ) : (
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
