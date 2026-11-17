import { formatDateWithTime, formatRelativeTime } from '../../lib/constants'
import { useServerTimezone } from '../../hooks/useJobs'

interface TimeWithRelativeProps {
  dateStr: string | null
  /** Relative time on the same line ("Nov 17, 10:00 AM · 4h ago") instead of below; for one-line summaries. */
  inline?: boolean
}

export function TimeWithRelative({ dateStr, inline = false }: TimeWithRelativeProps) {
  const timeZone = useServerTimezone()

  if (!dateStr) return <span>—</span>

  return (
    <span>
      {formatDateWithTime(dateStr, timeZone)}
      <span className={inline ? 'text-neutral-500' : 'block text-xs text-neutral-500'}>
        {inline && ' · '}
        {formatRelativeTime(dateStr, timeZone)}
      </span>
    </span>
  )
}
