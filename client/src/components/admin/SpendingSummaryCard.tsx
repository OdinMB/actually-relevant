import { Link } from 'react-router-dom'
import { useSpending } from '../../hooks/useSpending'
import { formatUsd, spendMonthName } from '../../lib/jobRun'
import { jobDisplayName } from '../../lib/constants'
import { Badge } from '../ui/Badge'
import { ErrorState } from '../ui/ErrorState'
import { LoadingSpinner } from '../ui/LoadingSpinner'

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-neutral-900">{value}</p>
    </div>
  )
}

/**
 * The Dashboard's spending summary: this month's total, the month at this pace, last month, and which
 * warning levels are passed or about to be. The table per job is on the Spending page.
 */
export function SpendingSummaryCard() {
  const query = useSpending()
  const data = query.data
  const warned = data ? [...data.groups.flatMap(g => g.rows), data.total].filter(row => row.warning) : []

  return (
    <section aria-labelledby="spending-title" className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="spending-title" className="text-lg font-semibold text-neutral-900">
          Spending
        </h2>
        <Link to="/admin/spending" className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
          See spending per job
        </Link>
      </div>
      {query.isLoading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      )}
      {query.error && <ErrorState message="Failed to load spending" onRetry={() => query.refetch()} />}
      {data && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <Figure label={`${spendMonthName(data.month)} so far (${data.day} of ${data.daysInMonth} days)`} value={formatUsd(data.total.thisMonth.totalUsd)} />
            <Figure label="Month at this pace" value={formatUsd(data.total.paceUsd)} />
            <Figure label={spendMonthName(data.previousMonths[0])} value={formatUsd(data.total.previousUsd[0])} />
          </div>
          {warned.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
              {warned.map(row => (
                <li key={row.scope}>
                  <Badge variant="yellow">
                    {row.scope === 'all' ? 'All jobs' : row.scope === 'editor_research' ? 'Editor research' : jobDisplayName(row.scope)}{' '}
                    {row.warning === 'passed' ? `passed $${row.levelUsd ?? ''}` : `on pace to pass $${row.levelUsd ?? ''}`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
