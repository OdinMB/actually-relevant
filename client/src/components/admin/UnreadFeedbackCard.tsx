import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../../lib/admin-api'
import { Card } from '../ui/Card'
import { NoticeTime } from './NoticeDisplay'

const SHOWN = 5

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  bug: 'Bug',
  suggestion: 'Suggestion',
  other: 'Other',
  correction: 'Correction',
}

/** The dashboard's unread feedback: the newest few and a link to the page. Hidden when there is none. */
export function UnreadFeedbackCard() {
  const query = useQuery({
    queryKey: ['admin', 'feedback', { status: 'unread', category: '', page: 1, limit: SHOWN }],
    queryFn: () => adminApi.feedback.list({ status: 'unread', page: 1, limit: SHOWN }),
  })
  const items = query.data?.items ?? []
  if (items.length === 0) return null
  const unread = query.data?.unreadCount ?? items.length

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-neutral-900">Unread feedback</h2>
        <Link to="/admin/feedback?status=unread" className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
          {unread > SHOWN ? `See all ${unread}` : 'Open feedback'}
        </Link>
      </div>
      <Card>
        <ul className="divide-y divide-neutral-100 -mx-4 -my-3">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="shrink-0 text-xs font-medium text-neutral-500">{CATEGORY_LABELS[item.category] ?? item.category}</span>
              <span className="flex-1 min-w-0 truncate text-neutral-900">{item.message}</span>
              <span className="shrink-0 text-neutral-500">
                <NoticeTime dateStr={item.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
