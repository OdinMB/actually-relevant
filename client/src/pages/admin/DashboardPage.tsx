import { useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import type { RecentStoryWindow } from '@shared/types'
import { useRecentStoryStats } from '../../hooks/useStoryStats'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { UnseenNoticesCard } from '../../components/admin/UnseenNoticesCard'
import { UnreadFeedbackCard } from '../../components/admin/UnreadFeedbackCard'
import { SpendingSummaryCard } from '../../components/admin/SpendingSummaryCard'
import { useToast } from '../../components/ui/Toast'
import { adminApi, ApiError } from '../../lib/admin-api'
import { Button } from '../../components/ui/Button'

const fmt = (n: number) => n.toLocaleString('en-US')
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '--')

function StoryWindow({ window: w }: { window: RecentStoryWindow }) {
  const figures = [
    { label: 'Crawled', value: fmt(w.crawled) },
    { label: 'Screened', value: fmt(w.screened), note: `${pct(w.screened, w.crawled)} of crawled` },
    { label: 'Fully assessed', value: fmt(w.assessed), note: `${pct(w.assessed, w.crawled)} of crawled` },
    { label: 'Published', value: fmt(w.published) },
  ]
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-neutral-700">Last {w.days} days</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {figures.map(f => (
          <div key={f.label}>
            <dt className="text-xs font-medium text-neutral-500">{f.label}</dt>
            <dd className="text-2xl font-bold tabular-nums text-neutral-900">{f.value}</dd>
            {f.note && <dd className="text-xs text-neutral-500">{f.note}</dd>}
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function DashboardPage() {
  const recentQuery = useRecentStoryStats()
  const clearCache = useMutation({ mutationFn: () => adminApi.cache.clear() })
  const { toast } = useToast()
  const { hash } = useLocation()
  const navigate = useNavigate()

  // Spending notices recorded before the Spending page existed link to `/admin#spending`
  useEffect(() => {
    if (hash === '#spending') navigate('/admin/spending', { replace: true })
  }, [hash, navigate])

  return (
    <>
      <Helmet>
        <title>Dashboard — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader
        title="Dashboard"
        description="What needs you, what it costs, and how many stories came through"
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={clearCache.isPending}
            title="Visitors' next page loads read the latest data instead of copies kept for up to a few minutes (related stories: days)"
            onClick={() =>
              clearCache.mutate(undefined, {
                onSuccess: ({ entries }) =>
                  toast(
                    'success',
                    `Site cache cleared (${entries} cached ${entries === 1 ? 'item' : 'items'}). Visitors get the latest data on their next page load.`,
                  ),
                onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to clear the site cache'),
              })
            }
          >
            Clear site cache
          </Button>
        }
      />

      <UnseenNoticesCard />

      <UnreadFeedbackCard />

      <SpendingSummaryCard />

      <section aria-labelledby="stories-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="stories-title" className="text-lg font-semibold text-neutral-900">
            Stories
          </h2>
          <Link to="/admin/stats" className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
            See all stats
          </Link>
        </div>
        {recentQuery.isLoading && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}
        {recentQuery.error && <ErrorState message="Failed to load story numbers" onRetry={() => recentQuery.refetch()} />}
        {recentQuery.data && (
          <div className="grid gap-4 xl:grid-cols-2">
            {recentQuery.data.map(w => (
              <StoryWindow key={w.days} window={w} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}
