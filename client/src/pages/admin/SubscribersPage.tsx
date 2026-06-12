import { useQuery } from '@tanstack/react-query'
import { Helmet } from 'react-helmet-async'
import { adminApi } from '../../lib/admin-api'
import type { SubscriberReconciliation } from '../../lib/admin-api'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { SubscribersTable } from '../../components/admin/SubscribersTable'
import { Button } from '../../components/ui/Button'
import { subscribersToCsv } from '../../lib/subscribersCsv'

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

function PlunkNotice({ plunk }: { plunk: SubscriberReconciliation['plunk'] }) {
  let message: string | null = null
  if (!plunk.available) {
    message = `Plunk is unavailable${plunk.error ? ` (${plunk.error})` : ''}, so the Plunk column is blank. Showing our database only.`
  } else if (plunk.partial || plunk.truncated) {
    message = `Plunk data is partial${plunk.truncated ? ' (contact list hit the scan limit)' : ' (the contact fetch did not finish)'}; counts and the Plunk column may be incomplete.`
  }
  if (!message) return null
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
      {message}
    </div>
  )
}

/** Trigger a client-side download of CSV text. */
function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke after the click is processed; revoking synchronously can yield an
  // empty download on Firefox/Safari before the Blob is read.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function SubscribersPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['subscribers'],
    queryFn: () => adminApi.subscribers.list(),
  })

  const handleExport = () => {
    if (!data) return
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`subscribers-${stamp}.csv`, subscribersToCsv(data.rows))
  }

  return (
    <>
      <Helmet>
        <title>Subscribers — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader
        title="Subscribers"
        actions={data && data.rows.length > 0 ? <Button onClick={handleExport}>Export CSV</Button> : undefined}
      />

      {isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
      {error && <ErrorState message="Failed to load subscribers" onRetry={() => refetch()} />}
      {data && (
        <>
          <PlunkNotice plunk={data.plunk} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 mb-6">
            <StatCard
              label="In Plunk"
              value={data.plunk.available ? data.plunk.total ?? 0 : '—'}
              hint={
                data.plunk.available
                  ? `${data.plunk.subscribed} subscribed · ${data.plunk.unsubscribed} unsubscribed`
                  : 'unavailable'
              }
            />
            <StatCard
              label="In our DB"
              value={data.db.total}
              hint={`${data.db.confirmed} confirmed · ${data.db.pending} pending`}
            />
            <StatCard
              label="Mismatches"
              value={data.plunk.available ? data.mismatches : '—'}
              hint="DB and Plunk disagree"
            />
            <StatCard
              label="Never-confirmed in Plunk"
              value={data.plunk.available ? data.plunk.unsubscribedNotInDb ?? 0 : '—'}
              hint="unsubscribed, no local row"
            />
          </div>

          {data.rows.length === 0 ? (
            <EmptyState
              title="No subscribers yet"
              description="Confirmed subscribers and subscribed Plunk contacts will appear here."
            />
          ) : (
            <SubscribersTable rows={data.rows} />
          )}
        </>
      )}
    </>
  )
}
