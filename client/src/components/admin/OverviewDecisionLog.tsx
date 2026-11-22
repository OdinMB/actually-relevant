import { useState } from 'react'
import type { AdminOverviewDecision } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useOverviewAction } from '../../hooks/useOverviews'
import { adminApi } from '../../lib/admin-api'
import { formatDateWithTime } from '../../lib/constants'
import { actorLabel, decisionKindLabel, STATUS_KINDS } from './overviewLabels'

/*
 * An overview's status history and its decision log on its admin page, newest first: the log its
 * newest decisions (the server's log size), the history every move. Undo shows on a decision the
 * server can reverse (`undoable`); the server refuses one when anything it changed was changed again
 * since (whole or not at all), and the toast gives its reason. An undo is itself a decision, and
 * undoing it restores what it reversed.
 */

/** A status decision in words: "open to quiet (faded)", or its outcome. */
export function describeStatus(d: Pick<AdminOverviewDecision, 'outcome' | 'move'>): string {
  const reason = d.move?.reason ? ` (${d.move.reason.replace(/_/g, ' ')})` : ''
  if (d.move?.from && d.move.to) return `${d.move.from} to ${d.move.to}${reason}`
  return `${d.outcome.replace(/_/g, ' ')}${reason}`
}

const UNDO_WHAT: Record<string, string> = {
  link: 'The story leaves the overview, and the pipeline never links it here again.',
  found: 'Both founding stories leave the overview. Unless other stories joined it since, it is left single and not public.',
  'status:closed': 'The overview is open again, and counts as active from now.',
  'status:frozen': 'The overview is unfrozen.',
  review:
    'Everything the review detached, relabeled, narrowed or retitled goes back, or nothing does: if any of it changed since, the undo is refused. The stories and OUT entries it restores are locked, so no later review takes them out again.',
  undo: 'What this undo reversed is restored.',
}
const undoWhat = (d: AdminOverviewDecision) =>
  UNDO_WHAT[`${d.kind}:${d.outcome}`] ?? UNDO_WHAT[d.kind] ?? 'What this decision changed goes back, unless something changed it again since.'

function Undone({ d }: { d: AdminOverviewDecision }) {
  if (!d.undoneAt) return null
  return (
    <span className="text-xs text-neutral-500">
      Undone{d.undoneByName ? ` by ${d.undoneByName}` : ''}, {formatDateWithTime(d.undoneAt)}
    </span>
  )
}

export function OverviewStatusHistory({ decisions }: { decisions: AdminOverviewDecision[] }) {
  const moves = decisions.filter(d => STATUS_KINDS.includes(d.kind) && d.outcome !== 'detached')
  return (
    <section aria-labelledby="overview-status-history" className="space-y-3">
      <h2 id="overview-status-history" className="text-lg font-semibold text-neutral-900">
        Status history
      </h2>
      {moves.length === 0 ? (
        <p className="text-sm text-neutral-500">No status changes yet.</p>
      ) : (
        <ul className="space-y-1 text-sm text-neutral-700">
          {moves.map(d => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="whitespace-nowrap text-xs text-neutral-500">{formatDateWithTime(d.createdAt)}</span>
              <span>
                {decisionKindLabel(d.kind)}: {describeStatus(d)}
              </span>
              <span className="text-xs text-neutral-500">{actorLabel(d.actor, d.actorName)}</span>
              <Undone d={d} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function OverviewDecisionLog({ decisions, total = decisions.length }: { decisions: AdminOverviewDecision[]; total?: number }) {
  const action = useOverviewAction()
  const [undoing, setUndoing] = useState<AdminOverviewDecision | null>(null)
  return (
    <section aria-labelledby="overview-log" className="space-y-3">
      <h2 id="overview-log" className="text-lg font-semibold text-neutral-900">
        Decision log
      </h2>
      {total > decisions.length && (
        <p className="text-sm text-neutral-500">
          The newest {decisions.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')} decisions.
        </p>
      )}
      {decisions.length === 0 ? (
        <p className="text-sm text-neutral-500">No decisions yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {decisions.map(d => (
            <li key={d.id} className={`px-4 py-3 ${d.undoneAt ? 'bg-neutral-50' : ''}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-neutral-900">{decisionKindLabel(d.kind)}</span>
                    <Badge variant={d.undoneAt ? 'gray' : 'blue'}>{d.outcome.replace(/_/g, ' ')}</Badge>
                    {d.storyTitle && <span className="truncate text-neutral-700">{d.storyTitle}</span>}
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-xs text-neutral-500">
                    <span>{formatDateWithTime(d.createdAt)}</span>
                    <span>{actorLabel(d.actor, d.actorName)}</span>
                    {d.model && <span>{d.model}</span>}
                    {d.confidence !== null && <span>confidence {Math.round(d.confidence * 100)}%</span>}
                    {d.costUsd > 0 && <span>${d.costUsd.toFixed(4)}</span>}
                    <Undone d={d} />
                  </p>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded">
                      Record
                    </summary>
                    <pre className="mt-1 max-h-72 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-[11px] text-neutral-700">
                      {JSON.stringify({ inputs: d.inputs, answer: d.answer }, null, 2)}
                    </pre>
                  </details>
                </div>
                {d.undoable && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setUndoing(d)}>
                    Undo
                    <span className="sr-only">
                      : {decisionKindLabel(d.kind)}, {formatDateWithTime(d.createdAt)}
                    </span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        onConfirm={() =>
          undoing && action.mutate({ run: () => adminApi.overviews.undo(undoing.id), done: 'Decision undone' }, { onSettled: () => setUndoing(null) })
        }
        title="Undo this decision?"
        description={undoing ? `${undoWhat(undoing)} The undo is logged, and can itself be undone.` : undefined}
        confirmLabel="Undo"
        loading={action.isPending}
      />
    </section>
  )
}
