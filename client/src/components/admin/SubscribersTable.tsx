import { Badge } from '../ui/Badge'
import type { BadgeVariant } from '../../lib/constants'
import { formatShortDate } from '../../lib/constants'
import type { SubscriberRow, SubscriberDbStatus, SubscriberPlunkStatus } from '../../lib/admin-api'

const DB_BADGE: Record<SubscriberDbStatus, BadgeVariant> = {
  confirmed: 'green',
  pending: 'yellow',
}

const PLUNK_BADGE: Record<SubscriberPlunkStatus, BadgeVariant> = {
  subscribed: 'green',
  unsubscribed: 'gray',
}

/** "—" when a side has no entry (or Plunk status is unknown). */
function StatusBadge<T extends string>({ status, variantMap }: { status: T | null; variantMap: Record<T, BadgeVariant> }) {
  if (!status) return <span className="text-neutral-400">—</span>
  return <Badge variant={variantMap[status]}>{status}</Badge>
}

export function SubscribersTable({ rows }: { rows: SubscriberRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <table className="min-w-full divide-y divide-neutral-200">
        <thead className="bg-neutral-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">Email</th>
            <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">In our DB</th>
            <th scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">In Plunk</th>
            <th scope="col" className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">Confirmed</th>
            <th scope="col" className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {rows.map(row => (
            <tr key={row.email} className={`hover:bg-neutral-50 ${row.mismatch ? 'bg-amber-50/40' : ''}`}>
              <td className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900 break-all">{row.email}</span>
                  {row.mismatch && (
                    <span title="Our DB and Plunk disagree for this address">
                      <Badge variant="orange">drift</Badge>
                    </span>
                  )}
                </div>
                {/* Mobile metadata */}
                <div className="flex flex-wrap items-center gap-1.5 mt-1 sm:hidden">
                  <span className="text-neutral-400 text-xs">DB</span>
                  <StatusBadge status={row.dbStatus} variantMap={DB_BADGE} />
                  <span className="text-neutral-400 text-xs">Plunk</span>
                  <StatusBadge status={row.plunkStatus} variantMap={PLUNK_BADGE} />
                </div>
              </td>
              <td className="hidden sm:table-cell whitespace-nowrap px-4 py-3 text-sm">
                <StatusBadge status={row.dbStatus} variantMap={DB_BADGE} />
              </td>
              <td className="hidden sm:table-cell whitespace-nowrap px-4 py-3 text-sm">
                <StatusBadge status={row.plunkStatus} variantMap={PLUNK_BADGE} />
              </td>
              <td className="hidden lg:table-cell whitespace-nowrap px-4 py-3 text-sm text-neutral-500">
                {formatShortDate(row.dbConfirmedAt)}
              </td>
              <td className="hidden lg:table-cell whitespace-nowrap px-4 py-3 text-sm text-neutral-500">
                {formatShortDate(row.dbCreatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
