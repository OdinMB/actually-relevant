/**
 * What readers get of a story's context (`GET /api/stories/:slug/context`; `.context/story-context.md`,
 * "What readers see"): a published story's boxes that are not demoted, in order, each with its place
 * on the page (`placeBoxes`, worked out now from the story as it stands), its sentences cited in
 * research's shape (`citedTextSchema`, sources numbered `C1…` in first-cited order), its tiles and
 * chart resolved under the tile and chart rules with formatted numbers, and its as-of date; plus the
 * `aiGenerated` marker. Not in the OpenAPI contract, so the shape can still change. A story without
 * context, or one not published, gets no boxes.
 */
import type { ContextBox } from '@prisma/client'
import { config } from '../config.js'
import { contextAiMarker, type AiGeneratedContextMarker } from '../lib/aiProvenance.js'
import { utcDay } from '../lib/days.js'
import prisma from '../lib/prisma.js'
import { SOURCE_KINDS } from '../schemas/research.js'
import type { BoxType } from '../schemas/storyContext.js'
import { hostOf, type CitedText, type ResearchedSource } from './researchedStory.js'
import { normalizedUrl } from './researchFilter.js'
import { visualFact } from './storyContextChecks.js'
import { storyLayout, type LayoutStory } from './storyContextLayout.js'
import { CONTEXT_STEP_TIERS } from './storyContextPipeline.js'
import { placeBoxes } from './storyContextPlacement.js'
import { boxContent, boxRefs, contextRecords, oneOf, shownFact, type StoredContextFact } from './storyContextRecords.js'
import { asOfFromColumns, periodStart, tileDisplay, validChart, type ChartPoint } from './storyContextVisuals.js'

export interface ContextTilesView {
  kind: 'tiles'
  tiles: { label: string; values: { text: string; estimate: boolean; sourceId: string }[] }[]
}

export interface ContextChartPointView {
  label: string
  value: number
  text: string
  /** Drawn hatched. */
  provisional: boolean
  /** Within 30 days of the story's day: the area's color. */
  recent: boolean
  asOf: string | null
  sourceId: string
}

export interface ContextChartView {
  kind: 'bars' | 'line'
  /** What every point measures: the chart's visible caption and accessible name. */
  caption: string
  unit: string
  points: ContextChartPointView[]
  /** A different measure shown beside the comparison, never in it: drawn lighter. */
  apart: { caption: string; unit: string; points: ContextChartPointView[] } | null
}

export interface ContextBoxView {
  id: string
  type: BoxType
  heading: string
  teaser: string
  /** `P<n>`, `W<n>` or `section`. */
  place: string
  sentences: CitedText[]
  visual: ContextTilesView | ContextChartView | null
  /** `YYYY-MM-DD`, `YYYY-MM` or `YYYY`: the newest date its facts describe. */
  asOf: string | null
  /** The box's sources (`C…`), for its footer, in first-cited order. */
  sourceIds: string[]
}

export interface StoryContextView {
  boxes: ContextBoxView[]
  sources: ResearchedSource[]
  /** The newest as-of date of the boxes. */
  asOf: string | null
  aiGenerated: AiGeneratedContextMarker
}

/** The story's places now, and where each box sits: the editor's place kept, else the mode's (`config.storyContext.placement`). */
export function placementsFor(
  story: LayoutStory & { id: string },
  boxes: Pick<ContextBox, 'id' | 'type' | 'place' | 'placeByEditor' | 'sentences' | 'visual'>[],
  facts: ReadonlyMap<string, StoredContextFact>,
): Map<string, string> {
  const layout = storyLayout(story)
  const c = config.storyContext
  return placeBoxes(
    boxes.map(b => ({
      id: b.id,
      type: b.type,
      place: b.place,
      placeByEditor: b.placeByEditor,
      sourceUrls: [...new Set(boxRefs(boxContent(b)).flatMap(ref => facts.get(ref)?.source.url ?? []))],
    })),
    layout,
    { mode: c.placement, storyId: story.id, notesInText: c.notesInText, notesByPoints: c.notesByPoints },
  )
}

const writeModel = () => config.llm.models[CONTEXT_STEP_TIERS.write].name

const emptyView = (): StoryContextView => ({ boxes: [], sources: [], asOf: null, aiGenerated: contextAiMarker(false, writeModel()) })

/** Numbers sources `C1…` in the order they are first cited, one per URL. */
function sourceBook(storyUrl: string) {
  const ids = new Map<string, string>()
  const sources: ResearchedSource[] = []
  return {
    sources,
    idOf(f: StoredContextFact): string {
      const key = normalizedUrl(f.source.url)
      let id = ids.get(key)
      if (!id) {
        id = `C${ids.size + 1}`
        ids.set(key, id)
        const host = hostOf(f.source.url)
        sources.push({
          id,
          origin: key === normalizedUrl(storyUrl) ? 'original' : 'source',
          outlet: f.source.outlet,
          host,
          url: host ? f.source.url : null,
          title: f.source.title,
          date: f.source.date,
          country: null,
          kind: oneOf(f.source.kind, SOURCE_KINDS, 'other'),
          storyId: null,
          slug: null,
        })
      }
      return id
    },
  }
}

const pointView = (p: ChartPoint, idOf: (ref: string) => string): ContextChartPointView => ({
  label: p.label,
  value: p.value,
  text: p.text,
  provisional: p.estimate,
  recent: p.recent,
  asOf: p.asOf,
  sourceId: idOf(p.ref),
})

export async function getStoryContext(slug: string): Promise<StoryContextView> {
  const story = await prisma.story.findFirst({
    where: { slug, status: 'published' },
    select: { id: true, sourceUrl: true, summary: true, relevanceReasons: true, antifactors: true, research: true, datePublished: true },
  })
  if (!story?.datePublished) return emptyView()
  const { boxes: rows, facts } = await contextRecords(prisma, story.id)
  const served = rows.filter(b => b.status !== 'demoted')
  if (served.length === 0) return emptyView()

  const storyDay = utcDay(story.datePublished)
  const windows = { fastDays: config.storyContext.fastValidDays, slowDays: config.storyContext.slowValidDays }
  const visuals = new Map([...facts.values()].map(f => [f.ref, visualFact(f, shownFact(f))]))
  const book = sourceBook(story.sourceUrl)
  const idOf = (ref: string) => book.idOf(facts.get(ref)!)

  const built = served.flatMap((row): { row: ContextBox; view: Omit<ContextBoxView, 'place'> }[] => {
    const content = boxContent(row)
    // A sentence citing a fact no longer shown goes with it
    const sentences = content.sentences.filter(s => s.factIds.length > 0 && s.factIds.every(ref => facts.has(ref) && shownFact(facts.get(ref)!)))
    const cited = sentences.map((s): CitedText => {
      const bySource = new Map<string, { sourceId: string; sentence: string | null }>()
      for (const ref of s.factIds) {
        const sourceId = idOf(ref)
        if (!bySource.has(sourceId)) bySource.set(sourceId, { sourceId, sentence: facts.get(ref)!.supportingSentence || null })
      }
      return { text: s.text, citations: [...bySource.values()] }
    })
    let visual: ContextBoxView['visual'] = null
    const v = content.visual
    if (v?.kind === 'tiles') {
      const tiles = v.tiles
        .map(t => ({
          label: t.label,
          shown: tileDisplay(
            t.factIds.flatMap(ref => visuals.get(ref) ?? []),
            storyDay,
            windows,
          ),
        }))
        .filter(t => t.shown.length > 0)
        .map(t => ({ label: t.label, values: t.shown.map(s => ({ text: s.text, estimate: s.estimate, sourceId: idOf(s.ref) })) }))
      visual = tiles.length > 0 ? { kind: 'tiles', tiles } : null
    } else if (v) {
      const chart = validChart(v, visuals, storyDay)
      if (chart)
        visual = {
          kind: chart.kind,
          caption: chart.measure,
          unit: chart.unit,
          points: chart.points.map(p => pointView(p, idOf)),
          apart: chart.apart ? { caption: chart.apart.measure, unit: chart.apart.unit, points: chart.apart.points.map(p => pointView(p, idOf)) } : null,
        }
    }
    // A box with nothing left to show is left out (so is a stored honest gap from before 2026-11-17)
    if (cited.length === 0 && visual === null) return []
    const sourceIds = [
      ...new Set([
        ...cited.flatMap(s => s.citations.map(c => c.sourceId)),
        ...(visual?.kind === 'tiles' ? visual.tiles.flatMap(t => t.values.map(x => x.sourceId)) : []),
        ...(visual && visual.kind !== 'tiles' ? [...visual.points, ...(visual.apart?.points ?? [])].map(p => p.sourceId) : []),
      ]),
    ]
    return [
      {
        row,
        view: {
          id: row.id,
          type: row.type,
          heading: row.heading,
          teaser: row.teaser,
          sentences: cited,
          visual,
          asOf: asOfFromColumns(row.asOf, row.asOfPrecision),
          sourceIds,
        },
      },
    ]
  })
  if (built.length === 0) return emptyView()
  // Placed once the boxes shown are known, so a box left empty takes no spot
  const places = placementsFor(
    { ...story, url: story.sourceUrl },
    built.map(b => b.row),
    facts,
  )
  const boxes = built.map(({ view }): ContextBoxView => ({ ...view, place: places.get(view.id) ?? 'section' }))
  const dated = boxes.flatMap(b => (b.asOf ? [b.asOf] : []))
  const asOf = dated.length === 0 ? null : dated.reduce((a, b) => (periodStart(b) > periodStart(a) ? b : a))
  const model = served.find(b => b.model)?.model ?? writeModel()
  return { boxes, sources: book.sources, asOf, aiGenerated: contextAiMarker(true, model) }
}
