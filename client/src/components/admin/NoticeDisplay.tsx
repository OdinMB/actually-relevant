import type { AdminNoticeSeverity, AdminNoticeSource } from '../../lib/admin-api'
import type { BadgeVariant } from '../../lib/constants'
import { formatDateWithTime, formatRelativeTime } from '../../lib/constants'
import { useServerTimezone } from '../../hooks/useJobs'
import { Badge } from '../ui/Badge'

const SEVERITY_VARIANTS: Record<AdminNoticeSeverity, BadgeVariant> = {
  critical: 'red',
  warning: 'yellow',
  info: 'gray',
}

export const NOTICE_SOURCE_LABELS: Record<AdminNoticeSource, string> = {
  jobs: 'Jobs',
  newsletter: 'Newsletter',
  podcast: 'Podcast',
  subscriptions: 'Subscriptions',
  plunk: 'Plunk',
}

/** A notice's severity as a colored chip whose text carries the meaning. */
export function NoticeSeverityBadge({ severity }: { severity: AdminNoticeSeverity }) {
  return <Badge variant={SEVERITY_VARIANTS[severity]}>{severity}</Badge>
}

/** Relative time ("3h ago"), with the full time as its tooltip. */
export function NoticeTime({ dateStr }: { dateStr: string }) {
  const timeZone = useServerTimezone()
  return (
    <time dateTime={dateStr} title={formatDateWithTime(dateStr, timeZone)} className="whitespace-nowrap">
      {formatRelativeTime(dateStr, timeZone)}
    </time>
  )
}
