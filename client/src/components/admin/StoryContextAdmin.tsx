import { useState } from 'react'
import type { ContextAdminBox, ContextAdminPlace, ContextAdminRun, Story } from '@shared/types'
import { contextShown, useSetContextHidden, useStoryContextAdmin, useUpdateContextBox } from '../../hooks/useStoryContextAdmin'
import { formatDateWithTime } from '../../lib/constants'
import { asOfText, slotKicker } from '../context/contextText'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { ContextRunView } from './ContextRunView'
import { EDITOR_HEADING, EDITOR_SECTION } from './storyEditorClasses'

/**
 * A story's Context section, the story page's Context tab (`.context/admin-dashboard.md`, "Story
 * context"): what the newest context run did and when, every card grouped by where it sits, with a
 * place select and Hide/Show, "Hide all context" (asked first), a link to the story page, and "What
 * the run did". "Gather context" (an editor's run, which builds on the earlier ones) is in the page's
 * action bar (`StoryActionBar`). Hiding and moving are the one way a person changes the cards
 * (ADR-0062); nothing is deleted. Hidden while the story has no context run and cannot have one
 * gathered, and against a backend without context (`contextShown`).
 */

type StoryRef = Pick<Story, 'id' | 'slug' | 'status'>

const SECTION = 'section'

const GROUPS: { name: string; has: (place: string) => boolean }[] = [
  { name: 'Beside the text', has: place => place.startsWith('P') },
  { name: 'Beside Why This Matters', has: place => place.startsWith('W') },
  { name: 'More context', has: place => !/^[PW]\d/.test(place) },
]

/** What the newest run did, in one sentence (the step's run or an editor's); cards still shown from an earlier run say so. */
function runLine(run: ContextAdminRun, hasBoxes: boolean): string {
  const when = formatDateWithTime(run.startedAt)
  const earlier = hasBoxes ? ' The cards below are from an earlier run.' : ''
  switch (run.status) {
    case 'running':
      return `A context run has been building this story's cards since ${when}.`
    case 'skipped':
      return `The newest context run skipped this story on ${when}: it had no research run with facts.${earlier}`
    case 'failed':
      return `The newest context run failed on ${when}: ${(run.error ?? 'no reason recorded').replace(/\.$/, '')}. It does not try again on its own.${earlier}`
    case 'completed':
      return run.outcome === 'none-kept'
        ? `The newest context run, on ${when}, kept no card.${earlier}`
        : `The newest context run built these cards on ${when}.`
  }
}

/** How many cards readers see and where, then how many are hidden. */
function countsLine(boxes: ContextAdminBox[], published: boolean): string | null {
  if (boxes.length === 0) return null
  const shown = boxes.filter(b => !b.hidden)
  const hidden = boxes.length - shown.length
  const hiddenText = hidden > 0 ? ` ${hidden} hidden.` : ''
  if (shown.length === 0) return `No card shows on the site.${hiddenText}`
  const [text, points, section] = GROUPS.map(g => shown.filter(b => g.has(b.place)).length)
  const where = `${text} beside the text, ${points} beside Why This Matters, ${section} under More context`
  const cards = shown.length === 1 ? '1 card shows' : `${shown.length} cards show`
  const unpublished = published ? '' : ' The story is not published now, so readers see none of them.'
  return `${cards} on the site: ${where}.${hiddenText}${unpublished}`
}

/** A place in the select: beside a paragraph or point, with its start, or More context. */
function placeLabel(place: ContextAdminPlace): string {
  if (place.place === SECTION) return 'More context'
  const where = `Beside ${place.label.replace(/^Paragraph/, 'paragraph')}`
  return place.text ? `${where}: ${place.text}` : where
}

function CardRow({ box, places, storyId }: { box: ContextAdminBox; places: ContextAdminPlace[]; storyId: string }) {
  const update = useUpdateContextBox(storyId)
  const { toast } = useToast()
  const title = box.heading
  // The server says which cards may move (In numbers stays under More context); a hidden card is moved once shown again
  const options = places.map(p => ({ value: p.place, label: placeLabel(p) }))
  if (!options.some(o => o.value === box.place)) options.push({ value: box.place, label: box.place })

  const change = (next: { hidden?: boolean; place?: string }, done: string) =>
    update.mutate(
      { boxId: box.id, change: next },
      {
        onSuccess: () => toast('success', done),
        onError: err => toast('error', `Couldn't change "${title}": ${err.message}`),
      },
    )
  const move = (place: string) => {
    const to = places.find(p => p.place === place)
    change({ place }, `Moved "${title}" ${to?.place === SECTION ? 'to More context' : `beside ${to?.label ?? place}`}.`)
  }
  const meta = [box.sources.map(s => s.outlet).join(', '), box.asOf && `as of ${asOfText(box.asOf)}`, box.placeByEditor && 'placed by an editor'].filter(
    Boolean,
  )

  return (
    <li className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3.5 py-3 ${box.hidden ? 'bg-neutral-50' : ''}`}>
      <div className="min-w-0 flex-1 basis-60">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${box.hidden ? 'text-neutral-400' : 'text-teal-700'}`}>
          {slotKicker(box.type)}
          {box.hidden && (
            <span className="ml-1.5 rounded-full bg-neutral-200 px-1.5 py-px align-[1px] text-[11px] normal-case tracking-normal text-neutral-600">Hidden</span>
          )}
        </p>
        <p className={`text-sm font-semibold ${box.hidden ? 'text-neutral-400 line-through decoration-neutral-300' : 'text-neutral-900'}`}>{title}</p>
        <p className="text-xs text-neutral-500">
          {box.teaser && (
            <>
              <span className="font-medium text-neutral-600">Phone line:</span> {box.teaser}
              {meta.length > 0 && ' · '}
            </>
          )}
          {meta.join(' · ')}
        </p>
        {box.hidden && <p className="text-xs text-neutral-500">Readers no longer see it; nothing was deleted.</p>}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-56">
          <Select
            aria-label={`Where ${title} sits`}
            value={box.place}
            disabled={!box.movable || box.hidden || update.isPending}
            onChange={e => move(e.target.value)}
            options={options}
            className="!py-1 !text-xs disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={update.isPending}
          aria-label={`${box.hidden ? 'Show' : 'Hide'} ${title}`}
          onClick={() =>
            box.hidden ? change({ hidden: false }, `"${title}" shows again.`) : change({ hidden: true }, `Hid "${title}": readers no longer see it.`)
          }
        >
          {box.hidden ? 'Show' : 'Hide'}
        </Button>
      </div>
    </li>
  )
}

function HideAll({ storyId, boxes }: { storyId: string; boxes: ContextAdminBox[] }) {
  const setHidden = useSetContextHidden(storyId)
  const { toast } = useToast()
  const [asking, setAsking] = useState(false)
  const anyShown = boxes.some(b => !b.hidden)
  const run = (hidden: boolean) =>
    setHidden.mutate(hidden, {
      onSuccess: () => {
        setAsking(false)
        toast('success', hidden ? 'Hid all context: readers no longer see any card of this story.' : 'All context shows again.')
      },
      onError: err => {
        setAsking(false)
        toast('error', `Couldn't change the context: ${err.message}`)
      },
    })

  if (boxes.length === 0) return null
  if (!anyShown)
    return (
      <Button type="button" variant="secondary" loading={setHidden.isPending} onClick={() => run(false)}>
        Show all context
      </Button>
    )
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setAsking(true)}>
        Hide all context
      </Button>
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => run(true)}
        title="Hide all context?"
        description="Readers stop seeing every card of this story. Nothing is deleted: Show all context brings them back."
        confirmLabel="Hide all context"
        loading={setHidden.isPending}
      />
    </>
  )
}

export function StoryContextAdmin({ story }: { story: StoryRef }) {
  const query = useStoryContextAdmin(story.id)
  const data = query.data

  if (query.isError)
    return (
      <section aria-labelledby={`context-${story.id}`} className={EDITOR_SECTION}>
        <h2 id={`context-${story.id}`} className={`${EDITOR_HEADING} mb-1`}>
          Context
        </h2>
        <p className="text-sm text-red-700">The story&apos;s context could not be loaded.</p>
      </section>
    )
  if (!data || !contextShown(query)) return null

  const published = story.status === 'published'
  const counts = countsLine(data.boxes, published)
  return (
    <section aria-labelledby={`context-${story.id}`} className={`${EDITOR_SECTION} space-y-3`}>
      <div>
        <h2 id={`context-${story.id}`} className={`${EDITOR_HEADING} mb-1`}>
          Context
        </h2>
        <p className="text-sm text-neutral-600">
          {data.run ? runLine(data.run, data.boxes.length > 0) : 'This story has no context cards yet.'}
          {counts && ` ${counts}`}
        </p>
      </div>
      {(data.boxes.length > 0 || (published && story.slug)) && (
        <div className="flex flex-wrap gap-2">
          <HideAll storyId={story.id} boxes={data.boxes} />
          {published && story.slug && (
            <a
              href={`/stories/${story.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              See it on the story page <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      )}
      {data.boxes.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {GROUPS.map(group => {
            const boxes = data.boxes.filter(b => group.has(b.place))
            if (boxes.length === 0) return null
            return (
              <div key={group.name} className="border-b border-neutral-100 last:border-b-0">
                <h3 className="border-b border-neutral-100 bg-neutral-50 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {group.name}
                </h3>
                <ul className="divide-y divide-neutral-100">
                  {boxes.map(box => (
                    <CardRow key={box.id} box={box} places={data.places} storyId={story.id} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      {data.run && <ContextRunView run={data.run} boxes={data.boxes} />}
    </section>
  )
}
