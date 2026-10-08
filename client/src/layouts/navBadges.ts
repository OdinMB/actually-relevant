/** The counts on the admin sidebar's nav items (Feedback, Notices). */

export type BadgeKey = 'feedback' | 'notices'

/** A count on a nav item; `critical` turns it red, and `description` says in words what the color shows. */
export interface NavBadge {
  count: number
  critical: boolean
  description: string
}

export function feedbackBadge(unreadCount: number | undefined): NavBadge | undefined {
  if (!unreadCount) return undefined
  return { count: unreadCount, critical: false, description: `${unreadCount} unread` }
}

export function noticeBadge(counts: { unseen: number; unseenCritical: number } | undefined): NavBadge | undefined {
  if (!counts?.unseen) return undefined
  const critical = counts.unseenCritical > 0
  return {
    count: counts.unseen,
    critical,
    description: `${counts.unseen} unseen${critical ? `, ${counts.unseenCritical} critical` : ''}`,
  }
}
