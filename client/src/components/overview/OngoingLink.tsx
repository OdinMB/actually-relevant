import { Link } from 'react-router-dom'
import type { PublicOverviewLink } from '@shared/types'
import { FOCUS_RING } from '../../lib/control-classes'
import AiBadge from '../ai/AiBadge'

/*
 * The link from a story to the public ongoing story it belongs to (`.context/public-website.md`,
 * "Ongoing stories"): a chip on its cards and a callout card on its page, shown only while the API
 * names one (`overview` is null while the module is off). The ongoing story's title is AI-written,
 * so it carries the "AI" badge, and `data-ai-generated="overview"` marks it.
 */

const ongoingPath = (overview: PublicOverviewLink) => `/ongoing/${encodeURIComponent(overview.slug)}`

/**
 * "Ongoing: [AI] <title>" on a story card, under its source line. The wrapper's inline-size
 * containment keeps the one-line title out of the card's minimum width: without it a long title
 * widened the homepage's and issue pages' grids past a phone's screen instead of truncating.
 */
export function OngoingChip({ overview, className = '' }: { overview: PublicOverviewLink | null | undefined; className?: string }) {
  if (!overview) return null
  return (
    <div className={`[contain:inline-size] ${className}`.trim()}>
      <Link
        to={ongoingPath(overview)}
        data-ai-generated="overview"
        className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-200 hover:text-brand-800 transition-colors ${FOCUS_RING}`}
      >
        <span className="shrink-0 font-semibold">Ongoing:</span>
        <AiBadge className="shrink-0" /> <span className="truncate">{overview.title}</span>
      </Link>
    </div>
  )
}

/**
 * Under a story page's header, a callout card that is one link to the ongoing story: the eyebrow
 * "Part of an ongoing story", the AI title behind its badge, "See the timeline" (until 2026-11-28 "…
 * and where things stand", which waits for the stands to switch on) and an arrow that nudges right on
 * hover or keyboard focus (not with reduced motion). Its name is its visible text, the eyebrow first
 * (WCAG 2.5.3); the arrow is decorative. `accent`, the
 * story's issue color, draws the bar on its left edge. Hover darkens the border, not the fill: the
 * eyebrow's neutral-500 is 4.5:1 on the neutral-50 fill and would fall below it on neutral-100.
 */
export function OngoingCallout({ overview, accent, className = '' }: { overview: PublicOverviewLink | null | undefined; accent: string; className?: string }) {
  if (!overview) return null
  return (
    <Link
      to={ongoingPath(overview)}
      data-ai-generated="overview"
      style={{ borderLeftColor: accent }}
      className={`group flex items-center gap-4 rounded-lg border border-l-4 border-neutral-200 bg-neutral-50 px-4 py-3 transition hover:border-neutral-300 hover:shadow-sm md:px-5 md:py-4 ${FOCUS_RING} ${className}`.trim()}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-widest text-neutral-500">Part of an ongoing story</span>{' '}
        {/* Inline, not flex: a wrapped title flows back under the badge instead of indenting */}
        <span className="mt-1 block text-lg font-semibold leading-snug text-neutral-900 group-hover:text-brand-800">
          <AiBadge className="mr-1.5 align-middle" /> {overview.title}
        </span>{' '}
        <span className="mt-1 block text-sm text-brand-700">See the timeline</span>
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 text-xl text-brand-700 motion-safe:transition-transform motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1"
      >
        &rarr;
      </span>
    </Link>
  )
}
