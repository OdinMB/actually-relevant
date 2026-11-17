import type { ContextBoxView, PublicStoryDetail, ResearchedStory } from '@shared/types'
import { parsePoints } from '../../lib/parse-points'

/**
 * Where each context card goes on the page. The server works out each box's place (`placeBoxes`,
 * `.context/story-context.md`, "Places"); the page puts a note after the paragraph or point it names
 * and every other card under More context. A place the page doesn't show (the story's text changed
 * since, or a second box names the same spot) falls back to More context, so no card is lost.
 */

export interface PlaceCounts {
  /** `P1`… : the researched paragraphs, or the summary as one. */
  paragraphs: number
  /** `W1`… : the Why This Matters points as the page shows them. */
  points: number
}

export interface PlacedContext {
  /** By paragraph index: the note after that paragraph, if any. */
  paragraphNotes: (ContextBoxView | undefined)[]
  /** By Why This Matters point index. */
  pointNotes: (ContextBoxView | undefined)[]
  /** More context, in box order. */
  section: ContextBoxView[]
}

/** The paragraphs and points the page shows, numbered as the server numbers them (`storyLayout`). */
export function placeCounts(story: Pick<PublicStoryDetail, 'summary' | 'relevanceReasons'>, research: ResearchedStory | null): PlaceCounts {
  if (research) return { paragraphs: research.paragraphs.length, points: research.whyThisMatters.length }
  return { paragraphs: story.summary ? 1 : 0, points: story.relevanceReasons ? parsePoints(story.relevanceReasons).length : 0 }
}

const SPOT = /^([PW])([1-9]\d*)$/

export function placeContext(boxes: ContextBoxView[], counts: PlaceCounts): PlacedContext {
  const placed: PlacedContext = { paragraphNotes: [], pointNotes: [], section: [] }
  for (const box of boxes) {
    const spot = box.type === 'figures' || box.gap ? null : SPOT.exec(box.place)
    const notes = spot?.[1] === 'P' ? placed.paragraphNotes : placed.pointNotes
    const index = spot ? Number(spot[2]) - 1 : -1
    const count = spot?.[1] === 'P' ? counts.paragraphs : counts.points
    if (spot && index < count && !notes[index]) notes[index] = box
    else placed.section.push(box)
  }
  return placed
}

/** Whether any card sits beside the text: the page then leaves room for them on wide screens. */
export const hasNotes = (placed: PlacedContext): boolean => placed.paragraphNotes.some(Boolean) || placed.pointNotes.some(Boolean)
