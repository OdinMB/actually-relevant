import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Story, StoryOverviewBlock } from '@shared/types'
import { ReasonButton } from '../ui/ReasonButton'
import { overviewsShown, useOverviewAction, useStoryOverview } from '../../hooks/useOverviews'
import { adminApi } from '../../lib/admin-api'
import { formatShortDate } from '../../lib/constants'
import { FIELD_FOCUS } from '../../lib/control-classes'
import { actorLabel, detachLabel, roleLabel, SCOPE_LABELS, STATUS_LABELS } from './overviewLabels'
import { EDITOR_HEADING, EDITOR_SECTION } from './storyEditorClasses'
import { returnState, storyPath } from './storyReturn'

/*
 * The story page's Overview block (Source tab, `.context/overviews.md`, "Admin"): the overview the
 * story is in, with Detach; or "Attach to overview…" while it is in none; the overviews it left; and
 * its last link decision with the candidates that call was shown and what the model said of each.
 * Shown only while the step is on or any overview exists.
 */

const TEXT_ACTION =
  'text-sm font-medium text-brand-700 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded'
const SELECT = `block w-full rounded-md border border-neutral-500 bg-white px-3 py-2 text-sm ${FIELD_FOCUS}`
const BELONGS: Record<string, string> = { yes: 'belongs', no: 'does not belong', unsure: 'unsure' }

const percent = (p: number) => `${Math.round(p * 100)}%`

type Ref = StoryOverviewBlock['attachable'][number]
const refMeta = (o: Ref) => `${SCOPE_LABELS[o.scope]}, ${STATUS_LABELS[o.status].toLowerCase()}`

export function StoryOverview({ story }: { story: Story }) {
  const block = useStoryOverview(story.id)
  const data = block.data
  if (!data || !overviewsShown(data)) return null
  return <OverviewBlock storyId={story.id} data={data} />
}

function OverviewBlock({ storyId, data }: { storyId: string; data: StoryOverviewBlock }) {
  const action = useOverviewAction()
  const location = useLocation()
  const [choice, setChoice] = useState('')
  const [confirmDetach, setConfirmDetach] = useState(false)
  const headingId = `overview-${storyId}`
  const selectId = `overview-attach-${storyId}`
  const { membership, left, lastLink, attachable } = data
  const chosen = attachable.find(o => o.id === choice)

  const attachReason = !data.published ? 'Only a published story can join an overview' : !chosen ? 'Choose an overview first' : null

  return (
    <section aria-labelledby={headingId} className={`${EDITOR_SECTION} space-y-3`}>
      <h2 id={headingId} className={EDITOR_HEADING}>
        Overview
      </h2>
      {membership ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">In</dt>
            <dd className="text-neutral-900">
              <Link to={`/admin/overviews/${membership.overview.id}`} className={TEXT_ACTION}>
                {membership.overview.title}
              </Link>{' '}
              <span className="text-xs text-neutral-500">({refMeta(membership.overview)})</span>
            </dd>
            <dt className="text-neutral-500">Role</dt>
            <dd className="text-neutral-900">{roleLabel(membership.role, membership.roleKind)}</dd>
            <dt className="text-neutral-500">Joined</dt>
            <dd className="text-neutral-900">
              {actorLabel(membership.joinedBy)}, {formatShortDate(membership.joinedAt)}
              {membership.confidence !== null && `, confidence ${percent(membership.confidence)}`}
              {membership.locked && ' (locked: the pipeline never reverses it)'}
            </dd>
          </dl>
          {confirmDetach ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-red-700">Detach the story? The pipeline will not link it to this overview again.</span>
              <button
                type="button"
                onClick={() =>
                  action.mutate(
                    { run: () => adminApi.overviews.detach(membership.overview.id, membership.entryId), done: 'Story detached' },
                    { onSettled: () => setConfirmDetach(false) },
                  )
                }
                disabled={action.isPending}
                className="text-sm font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
              >
                {action.isPending ? 'Detaching...' : 'Confirm'}
              </button>
              <button type="button" onClick={() => setConfirmDetach(false)} className="text-sm text-neutral-500 hover:text-neutral-700">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDetach(true)} className="text-sm font-medium text-red-700 hover:text-red-800">
              Detach from overview
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-neutral-700">Not in an overview.</p>
          {attachable.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-neutral-700">
                  Attach to overview
                </label>
                <select id={selectId} value={choice} onChange={e => setChoice(e.target.value)} className={SELECT}>
                  <option value="">Choose an overview…</option>
                  {attachable.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({refMeta(o)})
                    </option>
                  ))}
                </select>
              </div>
              <ReasonButton
                type="button"
                variant="secondary"
                reason={attachReason}
                loading={action.isPending}
                onClick={() =>
                  chosen &&
                  action.mutate(
                    { run: () => adminApi.overviews.attach(chosen.id, storyId), done: `Story attached to "${chosen.title}"` },
                    { onSuccess: () => setChoice('') },
                  )
                }
              >
                Attach
              </ReasonButton>
            </div>
          )}
        </div>
      )}

      {left.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-neutral-500">Overviews it left</h3>
          <ul className="space-y-0.5 text-sm text-neutral-700">
            {left.map(l => (
              <li key={l.entryId}>
                <Link to={`/admin/overviews/${l.overview.id}`} className={TEXT_ACTION}>
                  {l.overview.title}
                </Link>
                <span className="text-xs text-neutral-500">
                  {' '}
                  {detachLabel(l.detachReason)}, {formatShortDate(l.detachedAt)}
                  {l.locked && ' (locked)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastLink && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-neutral-500">Last link decision</h3>
          <p className="text-sm text-neutral-700">
            {lastLink.outcome}, {formatShortDate(lastLink.createdAt)}
            {lastLink.undoneAt && `, undone ${formatShortDate(lastLink.undoneAt)}`}
          </p>
          {lastLink.candidates.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-sm text-neutral-700" aria-label="Candidates the link decision was shown">
              {lastLink.candidates.map(c => (
                <li key={`${c.kind}-${c.id}`}>
                  <span className="font-mono text-xs text-neutral-500">{c.ref}</span>{' '}
                  {c.kind === 'overview' ? (
                    <Link to={`/admin/overviews/${c.id}`} className={TEXT_ACTION}>
                      {c.title ?? 'An overview deleted since'}
                    </Link>
                  ) : (
                    <Link to={storyPath(c.id)} state={returnState(location)} className={TEXT_ACTION}>
                      {c.title ?? 'A story deleted since'}
                    </Link>
                  )}
                  <span className="text-xs text-neutral-500">
                    {' '}
                    {c.kind === 'story' ? 'founding partner, ' : ''}distance {c.distance.toFixed(2)},{' '}
                    {c.belongs ? (BELONGS[c.belongs] ?? c.belongs) : 'not judged'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">It was shown no candidates.</p>
          )}
          {lastLink.refusals.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-neutral-500" aria-label="Answers the code refused">
              {lastLink.refusals.map(r => (
                <li key={r.id}>
                  {r.id}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
