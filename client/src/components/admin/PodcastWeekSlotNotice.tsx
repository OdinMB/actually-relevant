import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PodcastFridayRun, PodcastWeekSlot } from '@shared/types'
import { PodcastStageBadge } from './PodcastStageBadge'

const LINK = 'text-brand-700 hover:text-brand-800 font-medium'

/** Which outlook line the notice shows: a switched-off job first, then a passed window, then what Friday's run will do. */
export type SlotOutlook = 'job-off' | 'passed' | PodcastFridayRun

export function slotOutlook(slot: PodcastWeekSlot): SlotOutlook {
  if (!slot.automaticRunEnabled) return 'job-off'
  if (slot.fridayWindow === 'passed') return 'passed'
  return slot.fridayRun
}

const OUTLOOK: Record<SlotOutlook, ReactNode> = {
  'job-off': <>The automatic Friday run is off, so nothing happens on its own (<Link to="/admin/jobs" className={LINK}>Jobs</Link>).</>,
  passed: "This week's automatic run is over. The next one is next Friday, for next week's episode.",
  create: "Friday's automatic run will create and generate this week's episode.",
  finished: "Friday's automatic run makes nothing new this week.",
  'waiting-for-person': "Friday's automatic run leaves it waiting for you.",
  blocked: "Friday's automatic run skips it until you resume it.",
  advance: "Friday's automatic run will continue and finish it.",
}

/**
 * This week's weekly-episode slot in one or two lines: free, or the episode that claimed it, and
 * what Friday's automatic run will do. Renders nothing while the slot loads; not a live region, so
 * a refetch is not announced.
 */
export function PodcastWeekSlotNotice({ slot, failed = false }: { slot?: PodcastWeekSlot; failed?: boolean }) {
  if (!slot) {
    return failed ? <p className="mb-4 text-sm text-neutral-500">Could not check this week&apos;s slot.</p> : null
  }
  return (
    <section aria-label="This week's podcast" className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
      {slot.episode ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>This week&apos;s episode ({slot.weekKey}):</span>
          <Link to={`/admin/podcasts/${slot.episode.id}`} className={LINK}>{slot.episode.title}</Link>
          <PodcastStageBadge podcast={slot.episode} />
        </p>
      ) : (
        <p>This week&apos;s slot ({slot.weekKey}) is free.</p>
      )}
      <p className="mt-1 text-neutral-600">{OUTLOOK[slotOutlook(slot)]}</p>
    </section>
  )
}
