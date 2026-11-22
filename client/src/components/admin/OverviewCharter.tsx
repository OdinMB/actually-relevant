import { useState } from 'react'
import type { AdminOverviewDetail, OverviewCharter as Charter, OverviewRecenterRecord } from '@shared/types'
import { formatShortDate } from '../../lib/constants'
import { Button } from '../ui/Button'
import { OverviewCharterForm } from './OverviewCharterForm'
import { NO_END_EVENT, actorLabel } from './overviewLabels'

/*
 * An overview's charter on its admin page (`.context/overviews.md`, "Admin" and "Re-centering"): IN,
 * OUT and END_EVENT (or none), who drafted it, the count of automated re-centers against the limit,
 * the lock an editor's re-center or an Undo of automation's set, the stories linked since the last re-center that
 * pointed past the charter, "Edit charter", and the charter history from the re-center decisions.
 */

const CLOSED_REASONS: Record<string, string> = { faded: 'it faded', editor: 'an editor closed it' }

const LOCKED_BY: Record<'editor' | 'undo', string> = { editor: "an editor's re-center", undo: "an Undo of automation's re-center" }

const stories = (n: number) => (n === 1 ? '1 story' : `${n} stories`)

/** "Since the last re-center: 3 stories pointed past the charter, 1 reported that its center moved." */
function signalsLine(s: { wider: number; centerMoved: number }, recentered: boolean): string {
  const parts = [
    ...(s.wider > 0 ? [`${stories(s.wider)} pointed past the charter`] : []),
    ...(s.centerMoved > 0 ? [`${stories(s.centerMoved)} reported that its center moved`] : []),
  ]
  return `${recentered ? 'Since the last re-center' : 'Since it was founded'}: ${parts.join(', ')}`
}

function OutList({ out }: { out: string[] }) {
  if (out.length === 0) return <>—</>
  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {out.map(x => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  )
}

export function OverviewCharter({ overview: o }: { overview: AdminOverviewDetail }) {
  const [editing, setEditing] = useState(false)
  const r = o.recentering
  const atLimit = r.automated >= r.limit

  return (
    <section aria-labelledby="overview-about" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="overview-about" className="text-lg font-semibold text-neutral-900">
          Charter
        </h2>
        <Button type="button" variant="secondary" size="sm" disabled={o.status === 'closed'} onClick={() => setEditing(true)}>
          Edit charter
        </Button>
      </div>
      {o.status === 'closed' && <p className="text-xs text-neutral-500">Reopen the overview to edit its charter.</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <dt className="text-neutral-500">In</dt>
        <dd className="text-neutral-900">{o.charter.in || '—'}</dd>
        <dt className="text-neutral-500">Out</dt>
        <dd className="text-neutral-900">
          <OutList out={o.charter.out} />
        </dd>
        <dt className="text-neutral-500">Ends when</dt>
        <dd className="text-neutral-900">{o.charter.endEvent ?? NO_END_EVENT}</dd>
        <dt className="text-neutral-500">Drafted by</dt>
        <dd className="text-neutral-900">{o.charterModel}</dd>
        <dt className="text-neutral-500">Re-centering</dt>
        <dd className="text-neutral-900">
          {atLimit
            ? `Automatic re-centers: ${r.automated} of ${r.limit}: only an editor can re-center it now`
            : `Automatic re-centers: ${r.automated} of ${r.limit}`}
          {r.recenteredAt && (
            <span className="block text-neutral-500">
              Last re-centered {formatShortDate(r.recenteredAt)}
              {r.recenteredBy === 'recenter' ? ' by automation' : r.recenteredBy === 'editor' ? ' by an editor' : ''}
            </span>
          )}
          {r.lockedUntil && r.lockedBy && (
            <span className="block text-neutral-500">
              No automatic re-center until {formatShortDate(r.lockedUntil)}, after {LOCKED_BY[r.lockedBy]}
            </span>
          )}
          {(r.signals.wider > 0 || r.signals.centerMoved > 0) && (
            <span className="block text-neutral-500">{signalsLine(r.signals, r.recenteredAt !== null)}</span>
          )}
        </dd>
        <dt className="text-neutral-500">Founded</dt>
        <dd className="text-neutral-900">{formatShortDate(o.foundedAt)}</dd>
        <dt className="text-neutral-500">Entries</dt>
        <dd className="text-neutral-900">
          {o.entries} published, last {formatShortDate(o.lastEntryAt)}
        </dd>
        <dt className="text-neutral-500">Last review</dt>
        <dd className="text-neutral-900">{o.reviewedAt ? `${formatShortDate(o.reviewedAt)}, at ${o.entriesAtLastReview} entries` : 'Not reviewed yet'}</dd>
        {o.status === 'closed' && (
          <>
            <dt className="text-neutral-500">Closed</dt>
            <dd className="text-neutral-900">
              {formatShortDate(o.closedAt)}
              {o.closedReason && `: ${CLOSED_REASONS[o.closedReason] ?? o.closedReason}`}
            </dd>
          </>
        )}
        {o.issue && (
          <>
            <dt className="text-neutral-500">Issue</dt>
            <dd className="text-neutral-900">{o.issue.name}</dd>
          </>
        )}
      </dl>
      {r.history.length > 0 && <CharterHistory records={r.history} />}
      <OverviewCharterForm overview={o} open={editing} onClose={() => setEditing(false)} />
    </section>
  )
}

/** One field's change in a re-center: shown only where it changed. */
function Changed({ label, from, to }: { label: string; from: string; to: string }) {
  if (from === to) return null
  return (
    <p>
      <span className="text-neutral-500">{label}: </span>
      <del className="text-neutral-500">{from}</del> <ins className="no-underline text-neutral-900">{to}</ins>
    </p>
  )
}

const endEventText = (c: Charter) => c.endEvent ?? 'none'

/** The re-centers, newest first: who made each, when, whether it was undone, and what it changed. */
function CharterHistory({ records }: { records: OverviewRecenterRecord[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-neutral-900">Charter history</h3>
      <ul className="space-y-2" aria-label="Charter history">
        {records.map(h => (
          <li key={h.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm">
            <p className="text-neutral-700">
              {formatShortDate(h.createdAt)}, {h.kind === 'editor_recenter' ? actorLabel(h.actor, h.actorName) : 'automation'}
              {h.anchorConfirmed && ', anchor confirmed'}
              {h.undoneAt && <span className="text-neutral-500"> (undone {formatShortDate(h.undoneAt)})</span>}
            </p>
            <div className="mt-1 space-y-0.5">
              {h.title && <Changed label="Title" from={h.title.from} to={h.title.to} />}
              {h.charter && (
                <>
                  <Changed label="In" from={h.charter.from.in} to={h.charter.to.in} />
                  <Changed label="Out" from={h.charter.from.out.join('; ') || 'none'} to={h.charter.to.out.join('; ') || 'none'} />
                  <Changed label="Ends when" from={endEventText(h.charter.from)} to={endEventText(h.charter.to)} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
