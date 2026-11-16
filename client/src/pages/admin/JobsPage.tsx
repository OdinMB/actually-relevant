import { Helmet } from 'react-helmet-async'
import type { JobRun } from '@shared/types'
import { useJobs } from '../../hooks/useJobs'
import { byPipelineOrder } from '../../lib/constants'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { JobsTable } from '../../components/admin/JobsTable'
import { ChainCard } from '../../components/admin/ChainCard'

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

export default function JobsPage() {
  const jobsQuery = useJobs({ refetchInterval: 10_000 })
  const groups = jobsQuery.data ? groupJobs(jobsQuery.data) : null

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
        <div className="space-y-6">
          {groups.chains.map(({ chain, steps }) => (
            <ChainCard key={chain.jobName} chain={chain} steps={steps} />
          ))}
          {groups.standalone.length > 0 && (
            <section aria-labelledby="other-jobs-title">
              {groups.chains.length > 0 && (
                <h2 id="other-jobs-title" className="mb-2 text-base font-semibold text-neutral-900">
                  Other jobs
                </h2>
              )}
              <JobsTable jobs={groups.standalone} />
            </section>
          )}
        </div>
      )}
    </>
  )
}
