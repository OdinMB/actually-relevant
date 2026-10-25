import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { STORY_STATUSES } from '@shared/constants'
import type { LifetimeGroupRow, LifetimeStoryStats } from '@shared/types'
import { useLifetimeStoryStats } from '../../hooks/useStoryStats'
import { PageHeader } from '../../components/ui/PageHeader'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { formatStatus, STATUS_VARIANTS } from '../../lib/constants'

const fmt = (n: number) => n.toLocaleString('en-US')
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '--')

const RATINGS = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1']

const TH = 'py-2 px-3 font-medium text-neutral-500 whitespace-nowrap'
const TD = 'py-2 px-3 text-right tabular-nums text-neutral-700'

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-4">
      <p className="text-xs font-medium text-neutral-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-neutral-900">{value}</p>
      {note && <p className="text-xs text-neutral-500 mt-1">{note}</p>}
    </div>
  )
}

function Tiles({ stats }: { stats: LifetimeStoryStats }) {
  const screened = stats.total - (stats.byRelevancePre.none ?? 0)
  const assessed = stats.total - (stats.byRelevance.none ?? 0)
  const published = stats.byStatus.published ?? 0
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
      <Tile label="Stories crawled" value={fmt(stats.total)} />
      <Tile label="Screened" value={fmt(screened)} note={`${pct(screened, stats.total)} of crawled`} />
      <Tile label="Fully assessed" value={fmt(assessed)} note={`${pct(assessed, stats.total)} of crawled`} />
      <Tile label="Published" value={fmt(published)} note={`${pct(published, stats.total)} of crawled`} />
      <Tile label="Deleted by cleanup" value={fmt(stats.archived)} note="Still counted in every number here" />
    </div>
  )
}

/** One rating column: a count and a bar scaled to the largest bucket. */
function RatingTable({ title, counts }: { title: string; counts: Record<string, number> }) {
  const max = Math.max(1, ...RATINGS.map(r => counts[r] ?? 0))
  const rated = RATINGS.reduce((n, r) => n + (counts[r] ?? 0), 0)
  return (
    <Card title={title}>
      <table className="w-full text-sm">
        <caption className="sr-only">{title}: stories per rating</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Rating</th>
            <th scope="col">Stories</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {RATINGS.map(r => {
            const n = counts[r] ?? 0
            return (
              <tr key={r}>
                <th scope="row" className="py-0.5 pr-3 w-8 text-right font-normal text-neutral-600 tabular-nums">
                  {r}
                </th>
                <td className="py-0.5 pr-3">
                  <div className="h-3 rounded-sm bg-brand-500" style={{ width: `${(n / max) * 100}%`, minWidth: n > 0 ? 2 : 0 }} aria-hidden="true" />
                </td>
                <td className="py-0.5 pr-2 w-20 text-right tabular-nums text-neutral-700">{fmt(n)}</td>
                <td className="py-0.5 w-14 text-right tabular-nums text-neutral-500 text-xs">{pct(n, rated)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-neutral-500 mt-2">
        {fmt(rated)} rated, {fmt(counts.none ?? 0)} not rated
      </p>
    </Card>
  )
}

function StatusTable({ stats }: { stats: LifetimeStoryStats }) {
  return (
    <Card title="Final status">
      <table className="w-full text-sm">
        <caption className="sr-only">Stories per status, lifetime</caption>
        <tbody>
          {STORY_STATUSES.map(status => (
            <tr key={status} className="border-b border-neutral-100 last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal">
                <Badge variant={STATUS_VARIANTS[status]}>{formatStatus(status)}</Badge>
              </th>
              <td className="py-1.5 text-right tabular-nums text-neutral-700">{fmt(stats.byStatus[status] ?? 0)}</td>
              <td className="py-1.5 w-16 text-right tabular-nums text-neutral-500 text-xs">{pct(stats.byStatus[status] ?? 0, stats.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function MonthTable({ stats }: { stats: LifetimeStoryStats }) {
  return (
    <Card title="By month crawled">
      <div className="overflow-x-auto -mx-4 -my-3 max-h-[28rem] overflow-y-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Lifetime story counts by month crawled</caption>
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200">
              <th scope="col" className={`${TH} text-left`}>
                Month
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Crawled
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Screened
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Assessed
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Published
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Pub %
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Deleted
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.byMonth.map(m => (
              <tr key={m.month} className="border-b border-neutral-100 last:border-0">
                <th scope="row" className="py-2 px-3 text-left font-medium text-neutral-900 whitespace-nowrap">
                  {m.month}
                </th>
                <td className={TD}>{fmt(m.crawled)}</td>
                <td className={TD}>{fmt(m.screened)}</td>
                <td className={TD}>{fmt(m.assessed)}</td>
                <td className={TD}>{fmt(m.published)}</td>
                <td className={TD}>{pct(m.published, m.crawled)}</td>
                <td className={`${TD} text-neutral-500`}>{m.archived > 0 ? fmt(m.archived) : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

type SortKey = 'name' | 'crawled' | 'published' | 'rate' | 'avgRelevancePre' | 'highPre' | 'archived'

const sortValue = (row: LifetimeGroupRow, key: SortKey): number | string => {
  if (key === 'name') return row.name.toLowerCase()
  if (key === 'rate') return row.crawled > 0 ? row.published / row.crawled : -1
  if (key === 'avgRelevancePre') return row.avgRelevancePre ?? -1
  return row[key]
}

/** Feeds or issues, sortable by any column (largest first, name A to Z). */
function GroupTable({ title, label, rows, linkTo }: { title: string; label: string; rows: LifetimeGroupRow[]; linkTo?: (row: LifetimeGroupRow) => string }) {
  const [sort, setSort] = useState<SortKey>('crawled')
  const sorted = [...rows].sort((a, b) => {
    const va = sortValue(a, sort)
    const vb = sortValue(b, sort)
    if (va === vb) return a.name.localeCompare(b.name)
    if (sort === 'name') return va < vb ? -1 : 1
    return va < vb ? 1 : -1
  })

  const header = (key: SortKey, text: string, align: 'left' | 'right' = 'right') => (
    <th scope="col" className={`${TH} text-${align}`} aria-sort={sort === key ? (key === 'name' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => setSort(key)}
        className={`hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded ${sort === key ? 'text-neutral-900' : ''}`}
      >
        {text}
      </button>
    </th>
  )

  return (
    <Card title={title}>
      <div className="overflow-x-auto -mx-4 -my-3 max-h-[32rem] overflow-y-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">{title}, lifetime. Select a column header to sort.</caption>
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200">
              {header('name', label, 'left')}
              {header('crawled', 'Crawled')}
              {header('published', 'Published')}
              {header('rate', 'Pub %')}
              {header('avgRelevancePre', 'Avg screening')}
              {header('highPre', 'Screened 7+')}
              {header('archived', 'Deleted')}
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <th scope="row" className="py-2 px-3 text-left font-medium text-neutral-900">
                  {linkTo ? (
                    <Link to={linkTo(row)} className="hover:text-brand-700 hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </th>
                <td className={TD}>{fmt(row.crawled)}</td>
                <td className={TD}>{fmt(row.published)}</td>
                <td className={TD}>{pct(row.published, row.crawled)}</td>
                <td className={TD}>{row.avgRelevancePre?.toFixed(1) ?? '--'}</td>
                <td className={TD}>{fmt(row.highPre)}</td>
                <td className={`${TD} text-neutral-500`}>{row.archived > 0 ? fmt(row.archived) : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function StatsPage() {
  const query = useLifetimeStoryStats()

  return (
    <>
      <Helmet>
        <title>Stats — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader title="Stats" description="Lifetime totals of every story ever crawled, including the ones the monthly cleanup deleted" />

      {query.isLoading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      )}
      {query.error && <ErrorState message="Failed to load stats" onRetry={() => query.refetch()} />}
      {query.data && (
        <>
          <Tiles stats={query.data} />
          <div className="grid gap-4 lg:grid-cols-3 mb-8">
            <RatingTable title="Screening rating" counts={query.data.byRelevancePre} />
            <RatingTable title="Full assessment rating" counts={query.data.byRelevance} />
            <StatusTable stats={query.data} />
          </div>
          <div className="space-y-8">
            <GroupTable title="By source" label="Feed" rows={query.data.byFeed} linkTo={row => `/admin/feeds?open=${encodeURIComponent(row.id)}`} />
            <GroupTable title="By issue" label="Issue" rows={query.data.byIssue} />
            <MonthTable stats={query.data} />
          </div>
        </>
      )}
    </>
  )
}
