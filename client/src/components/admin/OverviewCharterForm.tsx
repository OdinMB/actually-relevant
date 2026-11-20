import { useState, type FormEvent } from 'react'
import type { AdminOverviewDetail, OverviewRecenterBody } from '@shared/types'
import { useOverviewAction } from '../../hooks/useOverviews'
import { adminApi } from '../../lib/admin-api'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { EditPanel, PANEL_BODY } from './EditPanel'
import { PanelFooter } from './PanelFooter'
import { NO_END_EVENT } from './overviewLabels'

/*
 * "Edit charter", an editor's re-center (`.context/overviews.md`, "Re-centering"): the title and the
 * whole charter, IN, OUT (one entry a line) and END_EVENT or none, saved only with the editor's word
 * that it still covers the overview's anchor, which the form lists. The server records that word and
 * judges nothing; the review it queues reads every entry under the new charter.
 */

/** The server's limits (`config.overviews`): what a title and the OUT list may hold. */
const TITLE_MAX = 200
const OUT_MAX = 12
const OUT_CHARS = 120

const lines = (text: string) =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

interface FormState {
  title: string
  within: string
  out: string
  endEvent: string
  noEndEvent: boolean
}

const initial = (o: AdminOverviewDetail): FormState => ({
  title: o.title,
  within: o.charter.in,
  out: o.charter.out.join('\n'),
  endEvent: o.charter.endEvent ?? '',
  noEndEvent: o.charter.endEvent === null,
})

/** The charter the form sends; its errors in the editor's words. */
function read(f: FormState): {
  body: Omit<OverviewRecenterBody, 'anchorConfirmed' | 'basedOn'>
  errors: Partial<Record<'title' | 'in' | 'out' | 'endEvent', string>>
} {
  const title = f.title.trim()
  const out = lines(f.out)
  const endEvent = f.noEndEvent ? null : f.endEvent.trim()
  const errors: Partial<Record<'title' | 'in' | 'out' | 'endEvent', string>> = {}
  if (!title) errors.title = 'A title is needed'
  else if (title.length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters`
  if (!f.within.trim()) errors.in = 'Say what the overview is about'
  if (out.length > OUT_MAX) errors.out = `At most ${OUT_MAX} entries`
  else if (out.some(l => l.length > OUT_CHARS)) errors.out = `Each entry at most ${OUT_CHARS} characters`
  if (endEvent === '') errors.endEvent = 'Name the end event, or tick "No end event"'
  return { body: { title, in: f.within.trim(), out, endEvent }, errors }
}

export function OverviewCharterForm({ overview: o, open, onClose }: { overview: AdminOverviewDetail; open: boolean; onClose: () => void }) {
  return (
    <EditPanel open={open} onClose={onClose} title="Edit charter">
      {open && <CharterForm overview={o} onClose={onClose} />}
    </EditPanel>
  )
}

function CharterForm({ overview: o, onClose }: { overview: AdminOverviewDetail; onClose: () => void }) {
  const action = useOverviewAction()
  const [form, setForm] = useState(() => initial(o))
  // The title and charter the form was opened on, kept while the page re-reads the overview: the server refuses the save when they changed since
  const [basedOn] = useState(() => ({ title: o.title, charter: o.charter }))
  const [confirmed, setConfirmed] = useState(false)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))
  const { body, errors } = read(form)
  const was = read(initial(o)).body
  const dirty = JSON.stringify(body) !== JSON.stringify(was)
  const invalid = Object.keys(errors).length > 0
  const r = o.recentering
  const lockedOut = r.lockedOut.filter(x => !body.out.some(l => l.toLowerCase() === x.toLowerCase()))

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (invalid || !confirmed || !dirty) return
    action.mutate({ run: () => adminApi.overviews.recenter(o.id, { ...body, anchorConfirmed: true, basedOn }), done: 'Charter saved' }, { onSuccess: onClose })
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-1 flex-col overflow-hidden">
      <div className={PANEL_BODY}>
        <Input id="charter-title" label="Title" value={form.title} maxLength={TITLE_MAX} onChange={e => set('title', e.target.value)} error={errors.title} />
        <Textarea
          id="charter-in"
          label="In: what the overview is about"
          rows={3}
          value={form.within}
          onChange={e => set('within', e.target.value)}
          error={errors.in}
        />
        <div>
          <Textarea
            id="charter-out"
            label="Out: what it is not about, one a line"
            rows={4}
            value={form.out}
            onChange={e => set('out', e.target.value)}
            error={errors.out}
          />
          {lockedOut.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              Locked out by an Undo, so no review adds them: {lockedOut.join('; ')}. Naming one here again lifts its lock.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Input
            id="charter-end-event"
            label="Ends when"
            value={form.noEndEvent ? '' : form.endEvent}
            disabled={form.noEndEvent}
            onChange={e => set('endEvent', e.target.value)}
            error={errors.endEvent}
          />
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
              checked={form.noEndEvent}
              onChange={e => set('noEndEvent', e.target.checked)}
            />
            {NO_END_EVENT}
          </label>
          {o.status === 'closing' && <p className="text-xs text-neutral-500">It is closing: a changed end event, or none, cancels the closing.</p>}
        </div>

        <section aria-labelledby="charter-anchor" className="space-y-2 border-t border-neutral-200 pt-4">
          <h3 id="charter-anchor" className="text-sm font-semibold text-neutral-900">
            This overview&apos;s anchor: a new charter should still cover these stories
          </h3>
          {r.anchor.standIns && <p className="text-xs text-neutral-500">No founding story is left, so its oldest entries stand in.</p>}
          {r.anchor.entries.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Anchor stories">
              {r.anchor.entries.map(a => (
                <li key={a.entryId} className="flex gap-2">
                  <span className="shrink-0 text-neutral-500">{a.founding ? (r.anchor.standIns ? 'Oldest' : 'Founding') : 'Turning point'}</span>
                  <span className="text-neutral-900">{a.title ?? 'A story no longer found'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-500">No active published entry anchors it.</p>
          )}
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
            />
            The new charter still covers them, or I mean to move the anchor
          </label>
          <p className="text-xs text-neutral-500">
            Saving queues a review of every entry under the new charter and keeps automation from re-centering it for {r.lockDays} days. Undo in the log takes
            it back.
          </p>
        </section>
      </div>
      <PanelFooter
        isPending={action.isPending}
        isDirty={dirty && confirmed && !invalid}
        onCancel={onClose}
        hint={dirty && !invalid && !confirmed ? 'Saving needs the anchor box ticked.' : null}
      />
    </form>
  )
}
