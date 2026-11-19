import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PublicOverviewEntry } from '@shared/types'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import { getHeadline } from '../../lib/title-label'
import StoryTitleLabel from '../StoryTitleLabel'
import { OverviewHeading } from './OverviewStands'
import { roleLine } from './overviewCopy'
import { offersFilter, timelineMonths, type TimelineFilter, type TimelineMonth } from './overviewTimeline'

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortDay = (iso: string) => SHORT_DAY.format(new Date(iso))

/** A filter button: pressed while its view shows. */
const FILTER_BUTTON = `inline-flex min-h-8 items-center rounded-full border px-3 text-sm transition-colors ${FOCUS_RING}`

/** A story of the timeline as `StoryTitleLabel` and `getHeadline` read one. */
const asStory = (e: PublicOverviewEntry) => ({ title: e.title, titleLabel: e.titleLabel, sourceTitle: e.title })

/**
 * One story: its day, its role when it is a turning point ("Turning point · setback"), its AI title
 * label and headline linking the story, and its research Updates as dated lines under it.
 */
function TimelineEntry({ entry, accent }: { entry: PublicOverviewEntry; accent: string }) {
  const role = roleLine(entry)
  return (
    <li className="relative grid grid-cols-[3.5rem_1fr] gap-3 py-3">
      <time dateTime={entry.datePublished} className="pt-0.5 text-sm text-neutral-500">
        {shortDay(entry.datePublished)}
      </time>
      <div className="relative min-w-0 border-l-2 border-neutral-200 pl-4">
        {/* The timeline's mark: filled in the area's color for a turning point */}
        <span
          className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 ${role ? '' : 'bg-white border-neutral-300'}`}
          style={role ? { backgroundColor: accent, borderColor: accent } : undefined}
          aria-hidden="true"
        />
        {role && <p className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-700">{role}</p>}
        <Link to={`/stories/${encodeURIComponent(entry.slug)}`} className={`group block ${FOCUS_RING} rounded`}>
          <StoryTitleLabel story={asStory(entry)} className="mb-0.5" />
          <span className="font-semibold leading-snug text-neutral-900 group-hover:text-brand-800">{getHeadline(asStory(entry))}</span>
        </Link>
        {/* A story may have two Updates on one day; the list never reorders, so its place keys it */}
        {entry.updates.map((update, i) => (
          <p key={`${update.date}-${i}`} className="mt-1 text-sm text-neutral-600">
            <span className="font-semibold">Updated {shortDay(update.date)}:</span> {update.note}
          </p>
        ))}
      </div>
    </li>
  )
}

/** One month: its heading, its stories, and its fold of routine stories, opened in place. */
function Month({ month, accent }: { month: TimelineMonth; accent: string }) {
  const [open, setOpen] = useState(false)
  const listId = `timeline-${month.key}`
  const entries = open ? month.all : month.shown
  return (
    <li>
      <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-500">{month.label}</h3>
      <ul id={listId}>
        {entries.map(entry => (
          <TimelineEntry key={entry.slug} entry={entry} accent={accent} />
        ))}
      </ul>
      {month.folded.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={listId}
          className={`ml-[4.25rem] inline-flex min-h-6 items-center text-sm ${TEXT_LINK}`}
        >
          {open ? 'Show fewer' : `+ ${month.folded.length} stories`}
        </button>
      )}
    </li>
  )
}

/**
 * The timeline (`.context/public-website.md`, "Ongoing stories"): every story readers see, newest
 * first, by month, the routine ones folded (`timelineMonths`). "All" and "Turning points" choose
 * the view while the timeline has both kinds.
 */
export function OverviewTimeline({ entries, accent }: { entries: PublicOverviewEntry[]; accent: string }) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const months = timelineMonths(entries, filter)
  const choose = (value: TimelineFilter, label: string) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`${FILTER_BUTTON} ${filter === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-500'}`}
    >
      {label}
    </button>
  )
  return (
    <section aria-labelledby="timeline-heading" className="mb-10" data-ai-generated="entries">
      <OverviewHeading id="timeline-heading" accent={accent}>
        Timeline
      </OverviewHeading>
      {offersFilter(entries) && (
        <div role="group" aria-label="Show" className="mb-6 flex flex-wrap gap-2">
          {choose('all', 'All')}
          {choose('turning', 'Turning points')}
        </div>
      )}
      {/* Remounted per view, so each view starts with its months folded */}
      <ol key={filter} className="space-y-6">
        {months.map(month => (
          <Month key={month.key} month={month} accent={accent} />
        ))}
      </ol>
    </section>
  )
}
