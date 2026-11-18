import type { AdminOverviewListItem } from '@shared/types'
import { Badge } from '../ui/Badge'

/** Whether readers see an overview once the step is on (ongoing and not hidden), and whether it is frozen or hidden. */
export function OverviewFlags({ overview }: { overview: Pick<AdminOverviewListItem, 'public' | 'frozen' | 'hidden'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {overview.public ? <Badge variant="green">Public</Badge> : <Badge variant="gray">Not public</Badge>}
      {overview.frozen && <Badge variant="blue">Frozen</Badge>}
      {overview.hidden && <Badge variant="yellow">Hidden</Badge>}
    </span>
  )
}

/** Shown while overviews exist but the step is off: no run changes them, and readers see none. */
export function StepOffNote() {
  return (
    <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      The Link Overviews step is off, so no run links, reviews or closes these overviews, and readers see none of them. An editor&apos;s changes here still
      count once it is on.
    </p>
  )
}
