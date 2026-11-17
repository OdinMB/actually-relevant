/**
 * Which of a story's boxes its page serves, and where each sits (`.context/story-context.md`, "What
 * readers see" and "Places"): one answer for the public view, the admin and the eval. A box is
 * served when it is not hidden and something in it is still shown: a sentence whose facts are all
 * shown, a tile with a current value, or a chart that still holds (the tile and chart rules on the
 * story's day). Only the served boxes compete for places, in their order, each by the sources of
 * every fact it cites, a chart's `apart` points included (`boxRefs`), under the configured mode
 * unless the caller names another. Pure.
 */
import type { ContextBox } from '@prisma/client'
import { config } from '../config.js'
import type { StoredSentence } from '../schemas/storyContext.js'
import { visualFact, type ContextFactData } from './storyContextChecks.js'
import type { StoryLayout } from './storyContextLayout.js'
import { placeBoxes, SECTION, type PlacementMode } from './storyContextPlacement.js'
import { boxContent, boxRefs, shownFact, type BoxContent } from './storyContextRecords.js'
import { tileDisplay, validChart, type ChartDisplay, type TileValue } from './storyContextVisuals.js'

/** A box as the page reads it: a stored row (`servableRow`), or a run's kept box with an id. */
export interface ServableBox {
  id: string
  type: string
  /** Demoted by a person: never served. */
  hidden: boolean
  /** The stored place: `P<n>`, `W<n>`, or null for the section. */
  place: string | null
  placeByEditor: boolean
  content: BoxContent
}

/** A stored box, read for serving. */
export const servableRow = <R extends Pick<ContextBox, 'id' | 'type' | 'status' | 'place' | 'placeByEditor' | 'sentences' | 'visual'>>(
  row: R,
): R & ServableBox => ({ ...row, hidden: row.status === 'demoted', content: boxContent(row) })

/** What a served box's tiles or chart show now. */
export type ServedVisual = { kind: 'tiles'; tiles: { label: string; values: TileValue[] }[] } | ChartDisplay

export interface ServedBox<B extends ServableBox = ServableBox> {
  box: B
  /** Its sentences whose facts are all still shown. */
  sentences: StoredSentence[]
  visual: ServedVisual | null
  /** The URLs of the sources of every fact it cites. */
  sourceUrls: string[]
}

export interface PlacedBox<B extends ServableBox = ServableBox> extends ServedBox<B> {
  /** `P<n>`, `W<n>` or `section`. */
  place: string
}

/** A fact as serving reads it: the run's, or a stored one a person may have demoted. */
type ServableFact = ContextFactData & { demoted?: boolean }

/** The boxes the page serves, in order, each with what it shows now. */
export function servedBoxes<B extends ServableBox>(boxes: B[], facts: ReadonlyMap<string, ServableFact>, storyDay: string): ServedBox<B>[] {
  const windows = { fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays }
  const visuals = new Map([...facts.values()].map(f => [f.ref, visualFact(f, shownFact(f))]))
  const shown = (ref: string) => {
    const f = facts.get(ref)
    return f !== undefined && shownFact(f)
  }
  return boxes.flatMap(box => {
    if (box.hidden) return []
    const { sentences: written, visual: spec } = box.content
    // A sentence citing a fact no longer shown goes with it
    const sentences = written.filter(s => s.factIds.length > 0 && s.factIds.every(shown))
    let visual: ServedVisual | null = null
    if (spec?.kind === 'tiles') {
      const tiles = spec.tiles
        .map(t => ({
          label: t.label,
          values: tileDisplay(
            t.factIds.flatMap(ref => visuals.get(ref) ?? []),
            storyDay,
            windows,
          ),
        }))
        .filter(t => t.values.length > 0)
      visual = tiles.length > 0 ? { kind: 'tiles', tiles } : null
    } else if (spec) visual = validChart(spec, visuals, storyDay)
    // A box with nothing left to show is left out (so is a stored honest gap from before 2026-11-17)
    if (sentences.length === 0 && visual === null) return []
    const sourceUrls = [...new Set(boxRefs(box.content).flatMap(ref => facts.get(ref)?.source.url ?? []))]
    return [{ box, sentences, visual, sourceUrls }]
  })
}

export interface PlaceOptions {
  /** Seeds the `random` draw. */
  storyId: string
  layout: Pick<StoryLayout, 'paragraphs' | 'points'>
  /** The configured mode (`config.storyContext.placement`) unless named: the eval judges two. */
  mode?: PlacementMode
}

/** The served boxes with their places, under production's limits (`placeBoxes`). */
export function placeServed<B extends ServableBox>(served: ServedBox<B>[], options: PlaceOptions): PlacedBox<B>[] {
  const c = config.storyContext
  const places = placeBoxes(
    served.map(({ box, sourceUrls }) => ({ id: box.id, place: box.place, placeByEditor: box.placeByEditor, sourceUrls })),
    options.layout,
    { mode: options.mode ?? c.placement, storyId: options.storyId, notesInText: c.notesInText, notesByPoints: c.notesByPoints },
  )
  return served.map(s => ({ ...s, place: places.get(s.box.id) ?? SECTION }))
}
