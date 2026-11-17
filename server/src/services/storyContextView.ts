/**
 * What readers get of a story's context (`GET /api/stories/:slug/context`; `.context/story-context.md`,
 * "What readers see"): the boxes a published story's page serves, in order, each with its place on
 * the page (`servedBoxes` and `placeServed`, worked out now from the story as it stands), its sentences cited in
 * research's shape (`citedTextSchema`, sources numbered `C1…` in first-cited order), its tiles and
 * chart resolved under the tile and chart rules with formatted numbers, and its as-of date; plus the
 * `aiGenerated` marker. Not in the OpenAPI contract, so the shape can still change. A story without
 * context, or one not published, gets no boxes.
 */
import { config } from '../config.js'
import { contextAiMarker, type AiGeneratedContextMarker } from '../lib/aiProvenance.js'
import { utcDay } from '../lib/days.js'
import prisma from '../lib/prisma.js'
import { SOURCE_KINDS } from '../schemas/research.js'
import type { BoxType } from '../schemas/storyContext.js'
import { hostOf, type CitedText, type ResearchedSource } from './researchedStory.js'
import { normalizedUrl } from './researchFilter.js'
import { storyLayout } from './storyContextLayout.js'
import { CONTEXT_STEP_TIERS } from './storyContextPipeline.js'
import { contextRecords, oneOf, type StoredContextFact } from './storyContextRecords.js'
import { placeServed, servableRow, servedBoxes } from './storyContextServed.js'
import { asOfFromColumns, periodStart, type ChartPoint } from './storyContextVisuals.js'

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
  const served = servedBoxes(rows.map(servableRow), facts, utcDay(story.datePublished))
  if (served.length === 0) return emptyView()
  // Placed once the boxes shown are known, so a box left empty takes no spot
  const placed = placeServed(served, { storyId: story.id, layout: storyLayout({ ...story, url: story.sourceUrl }) })

  const book = sourceBook(story.sourceUrl)
  const idOf = (ref: string) => book.idOf(facts.get(ref)!)
  const boxes = placed.map(({ box, sentences, visual: shown, place }): ContextBoxView => {
    const cited = sentences.map((s): CitedText => {
      const bySource = new Map<string, { sourceId: string; sentence: string | null }>()
      for (const ref of s.factIds) {
        const sourceId = idOf(ref)
        if (!bySource.has(sourceId)) bySource.set(sourceId, { sourceId, sentence: facts.get(ref)!.supportingSentence || null })
      }
      return { text: s.text, citations: [...bySource.values()] }
    })
    const visual: ContextBoxView['visual'] =
      shown === null
        ? null
        : shown.kind === 'tiles'
          ? {
              kind: 'tiles',
              tiles: shown.tiles.map(t => ({ label: t.label, values: t.values.map(s => ({ text: s.text, estimate: s.estimate, sourceId: idOf(s.ref) })) })),
            }
          : {
              kind: shown.kind,
              caption: shown.measure,
              unit: shown.unit,
              points: shown.points.map(p => pointView(p, idOf)),
              apart: shown.apart ? { caption: shown.apart.measure, unit: shown.apart.unit, points: shown.apart.points.map(p => pointView(p, idOf)) } : null,
            }
    const sourceIds = [
      ...new Set([
        ...cited.flatMap(s => s.citations.map(c => c.sourceId)),
        ...(visual?.kind === 'tiles' ? visual.tiles.flatMap(t => t.values.map(x => x.sourceId)) : []),
        ...(visual && visual.kind !== 'tiles' ? [...visual.points, ...(visual.apart?.points ?? [])].map(p => p.sourceId) : []),
      ]),
    ]
    return {
      id: box.id,
      type: box.type,
      heading: box.heading,
      teaser: box.teaser,
      place,
      sentences: cited,
      visual,
      asOf: asOfFromColumns(box.asOf, box.asOfPrecision),
      sourceIds,
    }
  })
  const dated = boxes.flatMap(b => (b.asOf ? [b.asOf] : []))
  const asOf = dated.length === 0 ? null : dated.reduce((a, b) => (periodStart(b) > periodStart(a) ? b : a))
  const model = served.find(s => s.box.model)?.box.model ?? writeModel()
  return { boxes, sources: book.sources, asOf, aiGenerated: contextAiMarker(true, model) }
}
