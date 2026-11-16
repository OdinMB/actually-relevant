/**
 * Where each context box sits on the story page (`.context/story-context.md`, "Places"), worked out
 * when the page is served, so a change of mode or limits reaches every story at once. Pure.
 *
 * A place an editor chose is kept in every mode; otherwise the mode decides: `model`, the place the
 * write call chose; `random`, a draw among the paragraphs and points that cite one of the box's
 * sources, seeded by the story so a page never reshuffles; `section`, none beside the text. Then the
 * limits, in box order with the editor's boxes first: at most `notesInText` beside paragraphs, at
 * most `notesByPoints` beside Why This Matters points, one per paragraph or point. The figures box
 * and the honest gap always go to the section, and so does a place the story no longer has.
 */
import { createHash } from 'node:crypto'
import { normalizedUrl } from './researchFilter.js'
import type { StoryLayout } from './storyContextLayout.js'

export type PlacementMode = 'model' | 'random' | 'section'

export interface PlacementBox {
  id: string
  type: string
  gap: boolean
  /** The stored place: `P<n>`, `W<n>`, or null for the section. */
  place: string | null
  placeByEditor: boolean
  /** The URLs of the sources its facts come from. */
  sourceUrls: string[]
}

export interface PlacementOptions {
  mode: PlacementMode
  /** Seeds the `random` draw. */
  storyId: string
  notesInText: number
  notesByPoints: number
}

export const SECTION = 'section'

/** A stable number in [0, 1) for the story and the box's order. */
function draw(storyId: string, index: number): number {
  return createHash('sha256').update(`${storyId}:${index}`).digest().readUInt32BE(0) / 2 ** 32
}

/** Each box's place by id: `P<n>`, `W<n>` or `section`. */
export function placeBoxes(boxes: PlacementBox[], layout: Pick<StoryLayout, 'paragraphs' | 'points'>, options: PlacementOptions): Map<string, string> {
  const spots = [...layout.paragraphs, ...layout.points]
  const exists = new Set(spots.map(s => s.id))
  const taken = new Set<string>()
  const used = { P: 0, W: 0 }
  const limit = { P: options.notesInText, W: options.notesByPoints }
  const kindOf = (spot: string) => (spot.startsWith('P') ? 'P' : 'W')
  const free = (spot: string) => exists.has(spot) && !taken.has(spot) && used[kindOf(spot)] < limit[kindOf(spot)]
  const take = (spot: string) => {
    taken.add(spot)
    used[kindOf(spot)]++
    return spot
  }

  const wanted = (box: PlacementBox, index: number): string | null => {
    if (box.placeByEditor || options.mode === 'model') return box.place
    if (options.mode === 'section') return null
    const urls = new Set(box.sourceUrls.map(normalizedUrl))
    const candidates = spots.filter(s => free(s.id) && s.sourceUrls.some(u => urls.has(normalizedUrl(u))))
    return candidates.length === 0 ? null : candidates[Math.floor(draw(options.storyId, index) * candidates.length)]!.id
  }

  const placed = new Map<string, string>()
  const order = [...boxes.map((box, index) => ({ box, index }))].sort((a, b) => Number(b.box.placeByEditor) - Number(a.box.placeByEditor) || a.index - b.index)
  for (const { box, index } of order) {
    if (box.type === 'figures' || box.gap) {
      placed.set(box.id, SECTION)
      continue
    }
    const spot = wanted(box, index)
    placed.set(box.id, spot !== null && free(spot) ? take(spot) : SECTION)
  }
  return placed
}
