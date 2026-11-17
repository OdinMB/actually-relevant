/**
 * The admin's view and edits of a story's context (`.context/story-context.md`, "Admin"): every box
 * of the story's newest context run with its status and where it sits now, the places the story has,
 * and the newest run's summary for "What the run did"; hiding and showing one box or all (a hidden box
 * is `demoted`, shown again `unreviewed`; nothing is deleted), and moving a box to a paragraph or point
 * the story has, or to More context, which keeps that place in every placement mode.
 */
import type { StoryContextRun } from '@prisma/client'
import { config } from '../config.js'
import prisma from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'
import { layoutSpots, storyLayout, type LayoutStory } from './storyContextLayout.js'
import { SECTION } from './storyContextPlacement.js'
import { boxContent, boxRefs, contextRecords, placementsFor } from './storyContextView.js'
import { asOfFromColumns } from './storyContextVisuals.js'

export interface ContextAdminBox {
  id: string
  type: string
  heading: string
  teaser: string
  status: string
  hidden: boolean
  /** Where it sits now: `P<n>`, `W<n>` or `section`; a hidden box's stored place, or `section`. */
  place: string
  /** As stored: the write call's choice or the editor's, null for the section. */
  storedPlace: string | null
  placeByEditor: boolean
  sources: { outlet: string; url: string }[]
  asOf: string | null
  position: number
}

export interface ContextAdminPlace {
  /** `P<n>`, `W<n>` or `section`. */
  place: string
  label: string
  /** The paragraph's or point's start, for the select; empty for the section. */
  text: string
}

export interface ContextAdminRun {
  id: string
  status: StoryContextRun['status']
  outcome: string | null
  startedAt: Date
  finishedAt: Date | null
  costUsd: number
  modelUsd: number
  searchUsd: number
  tavilyCredits: number
  boxes: number
  error: string | null
  /** What the run did (`ContextRunRecord`), as stored. */
  result: unknown
}

export interface ContextAdmin {
  /** The newest run; null while the story has none (the section is then hidden). */
  run: ContextAdminRun | null
  boxes: ContextAdminBox[]
  places: ContextAdminPlace[]
  placement: typeof config.storyContext.placement
}

const PLACE_TEXT_CHARS = 80

async function storyFor(storyId: string): Promise<LayoutStory & { id: string }> {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { id: true, sourceUrl: true, summary: true, relevanceReasons: true, antifactors: true, research: true },
  })
  if (!story) throw new NotFoundError('Story not found')
  return { ...story, url: story.sourceUrl }
}

function placesOf(story: LayoutStory): ContextAdminPlace[] {
  const layout = storyLayout(story)
  const cut = (text: string) => (text.length > PLACE_TEXT_CHARS ? `${text.slice(0, PLACE_TEXT_CHARS - 1).trimEnd()}…` : text)
  return [
    ...layout.paragraphs.map((p, i) => ({ place: p.id, label: `Paragraph ${i + 1}`, text: cut(p.text) })),
    ...layout.points.map((p, i) => ({ place: p.id, label: `Why This Matters ${i + 1}`, text: cut(p.text) })),
    { place: SECTION, label: 'More context', text: '' },
  ]
}

export async function getContextAdmin(storyId: string): Promise<ContextAdmin> {
  const story = await storyFor(storyId)
  const [run, { boxes, facts }] = await Promise.all([
    prisma.storyContextRun.findFirst({ where: { storyId }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    contextRecords(storyId),
  ])
  const shown = boxes.filter(b => b.status !== 'demoted')
  const placed = placementsFor(story, shown, facts)
  return {
    run: run && {
      id: run.id,
      status: run.status,
      outcome: run.outcome,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      costUsd: run.costUsd,
      modelUsd: run.modelUsd,
      searchUsd: Math.max(run.costUsd - run.modelUsd, 0),
      tavilyCredits: run.tavilyCredits,
      boxes: run.boxes,
      error: run.error,
      result: run.result,
    },
    boxes: boxes.map(b => {
      const sources = new Map<string, string>()
      for (const ref of boxRefs(boxContent(b))) {
        const f = facts.get(ref)
        if (f && !sources.has(f.source.url)) sources.set(f.source.url, f.source.outlet)
      }
      const hidden = b.status === 'demoted'
      return {
        id: b.id,
        type: b.type,
        heading: b.heading,
        teaser: b.teaser,
        status: b.status,
        hidden,
        place: hidden ? (b.place ?? SECTION) : (placed.get(b.id) ?? SECTION),
        storedPlace: b.place,
        placeByEditor: b.placeByEditor,
        sources: [...sources].map(([url, outlet]) => ({ outlet, url })),
        asOf: asOfFromColumns(b.asOf, b.asOfPrecision),
        position: b.position,
      }
    }),
    places: placesOf(story),
    placement: config.storyContext.placement,
  }
}

/** Hide every box of the story (`demoted`), or show the hidden ones again (`unreviewed`). */
export async function setContextHidden(storyId: string, hidden: boolean): Promise<void> {
  await storyFor(storyId)
  await prisma.contextBox.updateMany({
    where: { storyId, status: hidden ? { not: 'demoted' } : 'demoted' },
    data: { status: hidden ? 'demoted' : 'unreviewed' },
  })
}

/**
 * Hide or show one box, or move it: to a paragraph or point the story has now, or to `section`. An
 * editor's place is kept in every placement mode, under the same limits. 400 for a place the story
 * does not have; 404 for an unknown story or a box of another story.
 */
export async function updateContextBox(storyId: string, boxId: string, change: { hidden?: boolean; place?: string }): Promise<void> {
  const story = await storyFor(storyId)
  const box = await prisma.contextBox.findFirst({ where: { id: boxId, storyId }, select: { id: true, type: true } })
  if (!box) throw new NotFoundError('Context box not found')
  let place: { place: string | null; placeByEditor: true } | null = null
  if (change.place !== undefined) {
    if (box.type === 'figures' && change.place !== SECTION) throw new BadRequestError('The In numbers card always sits under More context')
    if (change.place !== SECTION && !layoutSpots(storyLayout(story)).has(change.place))
      throw new BadRequestError(`The story has no ${change.place}: choose one of its paragraphs or points, or section`)
    place = { place: change.place === SECTION ? null : change.place, placeByEditor: true }
  }
  await prisma.contextBox.update({
    where: { id: boxId },
    data: { ...(change.hidden !== undefined ? { status: change.hidden ? 'demoted' : 'unreviewed' } : {}), ...(place ?? {}) },
  })
}
