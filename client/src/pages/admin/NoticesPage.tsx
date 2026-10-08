import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { ADMIN_NOTICE_SOURCES, type AdminNotice, type AdminNoticeSource } from '../../lib/admin-api'
import { NOTICE_PAGE_SIZE, useMarkNoticeSeen, useMarkNoticesSeen, useNotices } from '../../hooks/useNotices'
import { useToast } from '../../components/ui/Toast'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { NOTICE_SOURCE_LABELS, NoticeSeverityBadge, NoticeTime } from '../../components/admin/NoticeDisplay'

const SELECT_CLASS =
  'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'

function parseSource(value: string | null): AdminNoticeSource | undefined {
  return (ADMIN_NOTICE_SOURCES as readonly string[]).includes(value ?? '') ? (value as AdminNoticeSource) : undefined
}

export default function NoticesPage() {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const source = parseSource(searchParams.get('source'))
  const show = searchParams.get('show') === 'unseen' ? 'unseen' : 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setSearchParams(next, { replace: true })
  }

  const noticesQuery = useNotices({ source, show, page })
  const markSeen = useMarkNoticeSeen()
  const markAllSeen = useMarkNoticesSeen()

  const items = noticesQuery.data?.items ?? []
  const total = noticesQuery.data?.total ?? 0
  const unseenCount = noticesQuery.data?.unseenCount ?? 0
  const totalPages = Math.ceil(total / NOTICE_PAGE_SIZE)

  // A later page emptied (its notices were marked seen under the unseen filter): go back to the last
  // page that has notices, rather than showing "No notices" with no pager.
  const pageEmptied = Boolean(noticesQuery.data) && items.length === 0 && total > 0 && page > 1
  useEffect(() => {
    if (pageEmptied) setParam('page', totalPages > 1 ? String(totalPages) : '')
  }, [pageEmptied, totalPages]) // setParam is recreated each render; these two decide the effect

  const toggle = (notice: AdminNotice) => {
    setExpandedId(expandedId === notice.id ? null : notice.id)
    // In the unseen-only view a seen notice drops out of the list on refetch, so expanding it there
    // leaves it unseen; the row's Mark seen button marks it once read.
    if (!notice.seenAt && show !== 'unseen') markSeen.mutate(notice.id)
  }

  const handleMarkAll = () => {
    markAllSeen.mutate(source, {
      onSuccess: ({ affected }) => toast('success', `Marked ${affected} notice(s) seen`),
      onError: () => toast('error', 'Failed to mark notices seen'),
    })
  }

  return (
    <>
      <Helmet>
        <title>Notices — Admin — Actually Relevant</title>
      </Helmet>

      <PageHeader
        title="Notices"
        description={unseenCount > 0 ? `${unseenCount} unseen` : 'No unseen notices'}
        actions={
          <Button variant="secondary" size="sm" onClick={handleMarkAll} loading={markAllSeen.isPending} disabled={unseenCount === 0}>
            Mark all seen
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={source ?? ''} onChange={e => setParam('source', e.target.value)} className={SELECT_CLASS} aria-label="Filter by source">
          <option value="">All sources</option>
          {ADMIN_NOTICE_SOURCES.map(s => (
            <option key={s} value={s}>{NOTICE_SOURCE_LABELS[s]}</option>
          ))}
        </select>
        <select value={show} onChange={e => setParam('show', e.target.value === 'unseen' ? 'unseen' : '')} className={SELECT_CLASS} aria-label="Show">
          <option value="all">All notices</option>
          <option value="unseen">Unseen only</option>
        </select>
      </div>

      {noticesQuery.isLoading && <div className="flex justify-center py-12"><LoadingSpinner /></div>}
      {noticesQuery.error && <ErrorState message="Failed to load notices" onRetry={() => noticesQuery.refetch()} />}
      {noticesQuery.data && items.length === 0 && <EmptyState title="No notices" />}
      {noticesQuery.data && items.length > 0 && (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <ul className="divide-y divide-neutral-200">
            {items.map(notice => (
              <li key={notice.id} className={notice.seenAt ? '' : 'bg-brand-50/40'}>
                <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(notice)}
                    aria-expanded={expandedId === notice.id}
                    className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <NoticeSeverityBadge severity={notice.severity} />
                      <span className="text-xs text-neutral-500">{NOTICE_SOURCE_LABELS[notice.source]}</span>
                      <span className="text-sm font-medium text-neutral-900">{notice.title}</span>
                      {notice.count > 1 && <span className="text-xs text-neutral-500" aria-label={`${notice.count} times`}>×{notice.count}</span>}
                      {!notice.seenAt && <Badge variant="blue">Unseen</Badge>}
                    </div>
                    <p className={`mt-1 text-sm text-neutral-700 ${expandedId === notice.id ? 'whitespace-pre-wrap' : 'truncate'}`}>
                      {notice.message}
                    </p>
                  </button>
                  <div className="flex items-center gap-3 text-sm text-neutral-500">
                    <NoticeTime dateStr={notice.lastOccurredAt} />
                    {notice.link && (
                      <Link to={notice.link} className="text-brand-600 hover:text-brand-700 hover:underline">
                        Open<span className="sr-only">: {notice.title}</span>
                      </Link>
                    )}
                    {!notice.seenAt && (
                      <Button variant="ghost" size="sm" onClick={() => markSeen.mutate(notice.id)}>
                        Mark seen<span className="sr-only">: {notice.title}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-4 py-3">
              <p className="text-sm text-neutral-500">{total} total</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                  Previous
                </Button>
                <span className="flex items-center text-sm text-neutral-600 px-2">Page {page} of {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
