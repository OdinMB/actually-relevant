import { Link } from 'react-router-dom'
import type { PublicOverviewLink } from '@shared/types'
import { FOCUS_RING } from '../../lib/control-classes'
import AiBadge from '../ai/AiBadge'

/*
 * The link from a story to the public ongoing story it belongs to (`.context/public-website.md`,
 * "Ongoing stories"): a chip on its cards and a line on its page, shown only while the API names one
 * (`overview` is null while the module is off). The ongoing story's title is AI-written, so it
 * carries the "AI" badge, and `data-ai-generated="overview"` marks it.
 */

const ongoingPath = (overview: PublicOverviewLink) => `/ongoing/${encodeURIComponent(overview.slug)}`

/** "Ongoing: [AI] <title>" on a story card, under its source line. */
export function OngoingChip({ overview, className = '' }: { overview: PublicOverviewLink | null | undefined; className?: string }) {
  if (!overview) return null
  return (
    <Link
      to={ongoingPath(overview)}
      data-ai-generated="overview"
      className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200 hover:text-brand-800 transition-colors ${FOCUS_RING} ${className}`.trim()}
    >
      <span className="shrink-0 font-semibold">Ongoing:</span>
      <AiBadge className="shrink-0" /> <span className="truncate">{overview.title}</span>
    </Link>
  )
}

/** "Part of an ongoing story: [AI] <title> →" under a story page's header. */
export function OngoingLine({ overview, className = '' }: { overview: PublicOverviewLink | null | undefined; className?: string }) {
  if (!overview) return null
  return (
    <p className={`text-sm text-neutral-600 ${className}`.trim()} data-ai-generated="overview">
      Part of an ongoing story:{' '}
      <Link to={ongoingPath(overview)} className={`font-semibold text-brand-700 underline hover:text-brand-800 ${FOCUS_RING} rounded px-0.5`}>
        <AiBadge className="mr-1 align-middle" /> {overview.title} <span aria-hidden="true">→</span>
      </Link>
    </p>
  )
}
