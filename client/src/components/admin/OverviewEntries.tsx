import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { AdminOverviewDetail, AdminOverviewEntry } from '@shared/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useOverviewAction } from '../../hooks/useOverviews'
import { adminApi } from '../../lib/admin-api'
import { formatShortDate, formatStatus } from '../../lib/constants'
import { FIELD_FOCUS } from '../../lib/control-classes'
import { actorLabel, detachLabel, parseRoleValue, ROLE_OPTIONS, roleLabel, roleValue } from './overviewLabels'
import { returnState, storyPath } from './storyReturn'

/*
 * An overview's entries on its admin page: active first, each with its story, role (an editor picks
 * one and sets it with its button: a change of the select alone writes nothing, since arrow keys
 * change it option by option, WCAG 3.2.2), who joined it and when, and the judgment the link
 * confirmation recorded (shared cause, place and end, each quoting both sides, confidence, model)
 * behind a toggle; Detach on an active one.
 */

const SELECT = `rounded-md border border-neutral-500 bg-white px-2 py-1 text-sm ${FIELD_FOCUS}`
const TOGGLE = 'text-xs font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded'
const SHARED_LABELS = { cause: 'Cause', place: 'Place', end: 'End' } as const

const storyName = (e: AdminOverviewEntry) => e.story?.title ?? 'A story deleted since'

export function OverviewEntries({ overview }: { overview: AdminOverviewDetail }) {
  const action = useOverviewAction()
  const [detaching, setDetaching] = useState<AdminOverviewEntry | null>(null)
  const active = overview.members.filter(e => e.status === 'active')
  const detached = overview.members.filter(e => e.status === 'detached')

  return (
    <section aria-labelledby="overview-entries" className="space-y-3">
      <h2 id="overview-entries" className="text-lg font-semibold text-neutral-900">
        Entries
      </h2>
      {overview.members.length === 0 && <p className="text-sm text-neutral-500">No entries.</p>}
      {active.length > 0 && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white" aria-label="Active entries">
          {active.map(e => (
            <EntryRow key={e.id} entry={e}>
              <RoleSetter overviewId={overview.id} entry={e} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setDetaching(e)}>
                Detach<span className="sr-only">: {storyName(e)}</span>
              </Button>
            </EntryRow>
          ))}
        </ul>
      )}
      {detached.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-neutral-700">Detached</h3>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white" aria-label="Detached entries">
            {detached.map(e => (
              <EntryRow key={e.id} entry={e}>
                <span className="text-sm text-neutral-700">{roleLabel(e.role, e.roleKind)}</span>
              </EntryRow>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={detaching !== null}
        onClose={() => setDetaching(null)}
        onConfirm={() =>
          detaching &&
          action.mutate({ run: () => adminApi.overviews.detach(overview.id, detaching.id), done: 'Story detached' }, { onSettled: () => setDetaching(null) })
        }
        title="Detach this story?"
        description={`"${detaching ? storyName(detaching) : ''}" leaves the overview, and the pipeline never links it here again. Undo in the log brings it back.`}
        confirmLabel="Detach"
        variant="danger"
        loading={action.isPending}
      />
    </section>
  )
}

/**
 * An active entry's role: the select holds the editor's choice, and "Set role" writes it. The select
 * stays usable while a request runs; the button says why it does nothing while the choice is the
 * entry's role or a request is under way (it stays focusable, so focus never drops to the page).
 */
function RoleSetter({ overviewId, entry: e }: { overviewId: string; entry: AdminOverviewEntry }) {
  const action = useOverviewAction()
  const current = roleValue(e.role, e.roleKind)
  const [choice, setChoice] = useState(current)
  // The entry's role changed on the server (this button, an Undo, a reload): the choice follows it
  const [seen, setSeen] = useState(current)
  if (seen !== current) {
    setSeen(current)
    setChoice(current)
  }
  const to = parseRoleValue(choice)
  const reason = action.isPending ? 'Setting the role…' : choice === current || !to ? 'Choose another role first' : null
  const set = () => {
    if (!to || reason) return
    action.mutate({ run: () => adminApi.overviews.setRole(overviewId, e.id, to.role, to.roleKind), done: `Role set: ${roleLabel(to.role, to.roleKind)}` })
  }
  return (
    <>
      <label className="sr-only" htmlFor={`role-${e.id}`}>
        Role of {storyName(e)}
      </label>
      <select id={`role-${e.id}`} value={choice} onChange={ev => setChoice(ev.target.value)} className={SELECT}>
        {/* A turning point stored without its kind still shows what it is */}
        {e.role === 'turning_point' && !e.roleKind && <option value="turning_point:">Turning point</option>}
        {ROLE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/* One element whatever its state (no swap into a tooltip wrapper), so focus stays on it after a click */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={set}
        aria-disabled={reason ? 'true' : undefined}
        aria-describedby={reason ? `role-why-${e.id}` : undefined}
        title={reason ?? undefined}
        className={reason ? 'opacity-50 cursor-not-allowed' : ''}
      >
        Set role<span className="sr-only">: {storyName(e)}</span>
      </Button>
      {reason && (
        <span id={`role-why-${e.id}`} className="sr-only">
          {reason}
        </span>
      )}
    </>
  )
}

function EntryRow({ entry: e, children }: { entry: AdminOverviewEntry; children: ReactNode }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const judgmentId = `judgment-${e.id}`
  const hasJudgment = e.shared !== null || e.confidence !== null || e.model !== null
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {e.story ? (
            <Link
              to={storyPath(e.story.id)}
              state={returnState(location)}
              className="text-sm font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              {storyName(e)}
            </Link>
          ) : (
            <span className="text-sm text-neutral-500">{storyName(e)}</span>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
            {e.story && (
              <span>
                {formatStatus(e.story.status)}, {formatShortDate(e.story.datePublished)}
              </span>
            )}
            <span>
              Joined: {actorLabel(e.joinedBy)}, {formatShortDate(e.joinedAt)}
            </span>
            {e.status === 'detached' && (
              <span>
                {detachLabel(e.detachReason)}, {formatShortDate(e.detachedAt)}
              </span>
            )}
            {e.locked && <Badge variant="purple">Locked</Badge>}
          </p>
        </div>
        <div className="flex items-center gap-2">{children}</div>
      </div>
      {hasJudgment && (
        <div className="mt-1">
          <button type="button" aria-expanded={open} aria-controls={judgmentId} onClick={() => setOpen(!open)} className={TOGGLE}>
            {open ? 'Hide judgment' : 'Show judgment'}
            <span className="sr-only">: {storyName(e)}</span>
          </button>
          <div id={judgmentId} hidden={!open} className="mt-2 space-y-1 text-sm text-neutral-700">
            {e.shared && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {(Object.keys(SHARED_LABELS) as (keyof typeof SHARED_LABELS)[]).map(k => (
                  <div key={k} className="contents">
                    <dt className="text-neutral-500">{SHARED_LABELS[k]}</dt>
                    <dd>
                      <q>{e.shared![k].story}</q> <span className="text-neutral-500">and</span> <q>{e.shared![k].other}</q>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-xs text-neutral-500">
              {e.confidence !== null && `Confidence ${Math.round(e.confidence * 100)}%. `}
              {e.model && `Model ${e.model}${e.promptVersion ? `, prompt ${e.promptVersion}` : ''}.`}
            </p>
          </div>
        </div>
      )}
    </li>
  )
}
