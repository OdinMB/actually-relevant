import { Link, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import type { AdminOverviewListItem, OverviewScope, OverviewStatus } from '@shared/types'
import { overviewsShown, useOverviewList, useOverviewsState, type OverviewFilters } from '../../hooks/useOverviews'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { SortableHeader, useSortableRows, type SortColumns } from '../../components/ui/SortableHeader'
import { formatShortDate } from '../../lib/constants'
import { FIELD_FOCUS } from '../../lib/control-classes'
import { OverviewFlags, StepOffNote } from '../../components/admin/OverviewFlags'
import { SCOPE_LABELS, STATUS_LABELS } from '../../components/admin/overviewLabels'

/*
 * `/admin/overviews` (`.context/overviews.md`, "Admin"): every overview, filtered by scope, status,
 * frozen and hidden (the filters in the address), with its entries, last entry and whether readers
 * see it; the newest last entry first until a column is sorted.
 */

const SELECT = `rounded-md border border-neutral-500 bg-white px-3 py-2 text-sm shadow-sm ${FIELD_FOCUS}`
const TH = 'px-3 py-2 font-medium text-neutral-500'

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined =>
  (values as readonly string[]).includes(value ?? '') ? (value as T) : undefined
const flag = (value: string | null): boolean | undefined => (value === 'true' ? true : value === 'false' ? false : undefined)

/** The list's filters as the address holds them; an unknown value is no filter. */
function readOverviewFilters(params: URLSearchParams): OverviewFilters {
  return {
    scope: oneOf<OverviewScope>(['single', 'forming', 'ongoing'], params.get('scope')),
    status: oneOf<OverviewStatus>(['open', 'quiet', 'closing', 'closed'], params.get('status')),
    frozen: flag(params.get('frozen')),
    hidden: flag(params.get('hidden')),
  }
}

type Column = 'title' | 'scope' | 'status' | 'entries' | 'lastEntry'
const COLUMNS: SortColumns<AdminOverviewListItem, Column> = {
  title: { value: o => o.title },
  scope: { value: o => o.scope },
  status: { value: o => o.status },
  entries: { value: o => o.entries },
  lastEntry: { value: o => o.lastEntryAt, firstDirection: 'desc' },
}

export default function OverviewsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = readOverviewFilters(searchParams)
  const state = useOverviewsState()
  const list = useOverviewList(filters)
  const { rows, sort, sortBy } = useSortableRows(list.data ?? [], COLUMNS, null)

  const setParam = (key: keyof OverviewFilters, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const filtered = Object.values(filters).some(v => v !== undefined)
  const hiddenHere = state.data !== undefined && !overviewsShown(state.data)

  return (
    <>
      <Helmet>
        <title>Overviews — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader title="Overviews" description="Developments followed across our stories, and every decision about them." />
      {state.data && !state.data.on && state.data.count > 0 && <StepOffNote />}

      {hiddenHere ? (
        <EmptyState title="No overviews yet" description="Overviews appear here once the Link Overviews step is switched on." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select value={filters.scope ?? ''} onChange={e => setParam('scope', e.target.value)} className={SELECT} aria-label="Filter by scope">
              <option value="">All scopes</option>
              {(Object.keys(SCOPE_LABELS) as OverviewScope[]).map(s => (
                <option key={s} value={s}>
                  {SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
            <select value={filters.status ?? ''} onChange={e => setParam('status', e.target.value)} className={SELECT} aria-label="Filter by status">
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABELS) as OverviewStatus[]).map(s => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select value={String(filters.frozen ?? '')} onChange={e => setParam('frozen', e.target.value)} className={SELECT} aria-label="Filter by frozen">
              <option value="">Frozen or not</option>
              <option value="true">Frozen</option>
              <option value="false">Not frozen</option>
            </select>
            <select value={String(filters.hidden ?? '')} onChange={e => setParam('hidden', e.target.value)} className={SELECT} aria-label="Filter by hidden">
              <option value="">Hidden or not</option>
              <option value="true">Hidden</option>
              <option value="false">Not hidden</option>
            </select>
          </div>

          {list.isLoading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          )}
          {list.error && <ErrorState message="Failed to load overviews" onRetry={() => list.refetch()} />}
          {list.data && rows.length === 0 && <EmptyState title={filtered ? 'No overviews match these filters' : 'No overviews yet'} />}
          {list.data && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="min-w-full divide-y divide-neutral-200 text-sm">
                <caption className="sr-only">Overviews</caption>
                <thead>
                  <tr>
                    <SortableHeader column="title" sort={sort} onSort={sortBy} className={TH}>
                      Title
                    </SortableHeader>
                    <SortableHeader column="scope" sort={sort} onSort={sortBy} className={TH}>
                      Scope
                    </SortableHeader>
                    <SortableHeader column="status" sort={sort} onSort={sortBy} className={TH}>
                      Status
                    </SortableHeader>
                    <SortableHeader column="entries" sort={sort} onSort={sortBy} align="right" className={TH}>
                      Entries
                    </SortableHeader>
                    <SortableHeader column="lastEntry" sort={sort} onSort={sortBy} className={TH}>
                      Last entry
                    </SortableHeader>
                    <th scope="col" className={`text-left ${TH}`}>
                      Readers
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {rows.map(o => (
                    <tr key={o.id}>
                      <td className="px-3 py-2">
                        <Link
                          to={`/admin/overviews/${o.id}`}
                          className="font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                        >
                          {o.title}
                        </Link>
                        {o.issue && <span className="block text-xs text-neutral-500">{o.issue.name}</span>}
                      </td>
                      <td className="px-3 py-2 text-neutral-700">{SCOPE_LABELS[o.scope]}</td>
                      <td className="px-3 py-2 text-neutral-700">{STATUS_LABELS[o.status]}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{o.entries}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{formatShortDate(o.lastEntryAt)}</td>
                      <td className="px-3 py-2">
                        <OverviewFlags overview={o} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
