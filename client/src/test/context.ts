import type { ContextBoxView, ResearchedSource, StoryContextView } from '@shared/types'
import type { SourcesById } from '../components/research/Citation'

/** A context source (`C1`…), as `GET /api/stories/:slug/context` serves it. */
export const contextSource = (id: string, outlet: string): ResearchedSource => ({
  id,
  origin: 'source',
  outlet,
  host: `${outlet.toLowerCase().replace(/\W+/g, '')}.example.org`,
  url: `https://${outlet.toLowerCase().replace(/\W+/g, '')}.example.org/a`,
  title: `${outlet} article`,
  date: '2026-11-12',
  country: null,
  kind: 'news-report',
  storyId: null,
  slug: null,
})

export const CONTEXT_SOURCES = [contextSource('C1', 'Budget Office'), contextSource('C2', 'Plains Ledger')]

export const contextSourcesById = (sources: ResearchedSource[] = CONTEXT_SOURCES): SourcesById => new Map(sources.map(s => [s.id, s]))

export const contextBox = (id: string, extra: Partial<ContextBoxView> = {}): ContextBoxView => ({
  id,
  type: 'compared',
  heading: `Heading ${id}`,
  teaser: `Teaser ${id}`,
  place: 'section',
  sentences: [{ text: `Sentence of ${id}.`, citations: [{ sourceId: 'C1', sentence: 'The source says so.' }] }],
  visual: null,
  asOf: '2026-11-12',
  sourceIds: ['C1'],
  ...extra,
})

/** A phone note's button name: its visible kicker and teaser, parted by a hidden colon (spacing varies by engine). */
export const noteButtonName = (kicker: string, teaser: string) => new RegExp(`^${kicker}\\s*:\\s*${teaser}$`)

export const storyContext = (boxes: ContextBoxView[], sources: ResearchedSource[] = CONTEXT_SOURCES): StoryContextView => ({
  boxes,
  sources,
  asOf: '2026-11-12',
  aiGenerated: { fields: boxes.length ? ['heading', 'teaser', 'sentences', 'visual'] : [], model: 'test-model', digitalSourceType: 'trainedAlgorithmicMedia' },
})
