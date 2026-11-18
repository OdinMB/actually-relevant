import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import type { JobRun } from '@shared/types'
import { useJobs } from '../../hooks/useJobs'
import { byPipelineOrder } from '../../lib/constants'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { JobEditPanel } from '../../components/admin/JobEditPanel'
import { ChainRows } from '../../components/admin/ChainRows'
import { JobTable, OtherJobRows } from '../../components/admin/jobTable'

/** The chains with their step rows in chain order, and the jobs that run on their own schedules. */
function groupJobs(jobs: JobRun[]) {
  const byName = new Map(jobs.map(job => [job.jobName, job]))
  const chains = jobs
    .filter(job => job.steps)
    .sort(byPipelineOrder)
    .map(chain => ({ chain, steps: (chain.steps ?? []).flatMap(name => byName.get(name) ?? []) }))
  const standalone = jobs.filter(job => !job.steps && !job.chain)
  return { chains, standalone }
}

/** Every job in one table: each chain's row with its steps indented under it, then the other jobs. */
export default function JobsPage() {
  const jobsQuery = useJobs({ refetchInterval: 10_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const groups = jobsQuery.data ? groupJobs(jobsQuery.data) : null
  const panelJob = jobsQuery.data?.find(job => job.jobName === selected)

  return (
    <>
      <Helmet>
        <title>Jobs — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader title="Jobs" description="Scheduled background jobs. Auto-refreshes every 10 seconds." />

      {jobsQuery.isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}
      {jobsQuery.error && <ErrorState message="Failed to load jobs" onRetry={() => jobsQuery.refetch()} />}
      {jobsQuery.data && jobsQuery.data.length === 0 && <EmptyState title="No jobs configured" />}
      {groups && jobsQuery.data && jobsQuery.data.length > 0 && (
        <JobTable>
          {groups.chains.map(({ chain, steps }) => (
            <ChainRows key={chain.jobName} chain={chain} steps={steps} onOpen={setSelected} />
          ))}
          {groups.standalone.length > 0 && <OtherJobRows jobs={groups.standalone} heading={groups.chains.length > 0} onOpen={setSelected} />}
        </JobTable>
      )}

      {panelJob && <JobEditPanel job={panelJob} onClose={() => setSelected(null)} />}
    </>
  )
}
