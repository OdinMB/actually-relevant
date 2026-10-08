import { Link } from 'react-router-dom'
import { useNotices } from '../../hooks/useNotices'
import { Card } from '../ui/Card'
import { NoticeSeverityBadge, NoticeTime } from './NoticeDisplay'

const SHOWN = 5

/** The dashboard's summary of unseen notices: the newest few and a link to the page. Hidden when there are none. */
export function UnseenNoticesCard() {
  const query = useNotices({ show: 'unseen', page: 1, limit: SHOWN })
  const items = query.data?.items ?? []
  if (items.length === 0) return null
  const unseen = query.data?.unseenCount ?? items.length

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-neutral-900">Unseen notices</h2>
        <Link to="/admin/notices?show=unseen" className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
          {unseen > SHOWN ? `See all ${unseen}` : 'Open notices'}
        </Link>
      </div>
      <Card>
        <ul className="divide-y divide-neutral-100 -mx-4 -my-3">
          {items.slice(0, SHOWN).map(notice => (
            <li key={notice.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <NoticeSeverityBadge severity={notice.severity} />
              <span className="flex-1 min-w-0 truncate text-neutral-900">{notice.title}</span>
              <span className="text-neutral-500"><NoticeTime dateStr={notice.lastOccurredAt} /></span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
