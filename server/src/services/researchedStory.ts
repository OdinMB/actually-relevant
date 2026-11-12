/**
 * The researched version of a story as readers see it (`.context/story-research.md`, "Reader
 * format"): its shape and Zod schema, how it is built from a research run, and how it is trimmed at
 * read time. Pure.
 *
 * The projection is built once, when a run is applied to its story, and stored in `stories.research`.
 * It keeps the cited text and the sources a reader needs, never the run's calls, drops or facts.
 */
import { z } from 'zod'
import { SOURCE_KINDS, type Draft } from '../schemas/research.js'
import { publishedFact } from './researchChecks.js'
import type { ResearchEarlier, ResearchSource } from './researchPipeline.js'

/** How the sources list and the citations name our own earlier stories. */
export const OUR_OUTLET = 'Actually Relevant'

const citationSchema = z.object({
  sourceId: z.string().describe('Id of the cited source in `sources`.'),
  sentence: z
    .string()
    .nullable()
    .describe("The source's own sentence that supports the text, in its original language; null when the text cites only the source's date."),
})

const citedTextSchema = z.object({
  text: z.string().describe('Plain text, no Markdown.'),
  citations: z.array(citationSchema).describe('One entry per cited source, in the order they are first cited; empty for text that only judges.'),
})

/** The address parsed, when it is http(s) (as a browser reads it); null for any other address. */
function httpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

const researchedSourceSchema = z.object({
  id: z.string().describe('`S0` is the article the story was initially found in; `E1`, `E2` … are earlier Actually Relevant stories.'),
  origin: z
    .enum(['original', 'source', 'earlier'])
    .describe('`original`: the article the story was initially found in. `earlier`: an earlier Actually Relevant story.'),
  outlet: z
    .string()
    .describe(
      "The outlet's name: its feed's name for an article we crawled (the original among them); for a source found by search, the name an AI model read from its page, else its web address; `Actually Relevant` for an earlier story.",
    ),
  host: z.string().nullable().describe('Host name of the source, without `www.`; null for an earlier story.'),
  // Readers' links take it as their href, so a stored value that is not http(s) fails the read-time parse
  url: z
    .string()
    .refine(url => httpUrl(url) !== null, 'Not an http(s) address')
    .nullable()
    .describe('The source article, an http(s) address; null for an earlier story, which is linked by its slug.'),
  title: z.string().describe("The source's own headline (not AI-generated), or the earlier story's AI headline."),
  date: z.string().nullable().describe('When the source was published, as the source or search gives it.'),
  country: z.string().nullable().describe('Country the outlet is based in, as an AI model read it from the source.'),
  kind: z.enum(SOURCE_KINDS).nullable().describe('Kind of source, as an AI model classified it; null for an earlier story.'),
  storyId: z.string().nullable().describe('Id of the earlier story; null for any other source.'),
  slug: z.string().nullable().describe('Story page slug of the earlier story; null for any other source.'),
})

export const researchedStorySchema = z.object({
  paragraphs: z
    .array(z.object({ sentences: z.array(citedTextSchema) }))
    .describe('The story, in place of the summary: its paragraphs, each a list of cited sentences.'),
  whyThisMatters: z.array(citedTextSchema).describe('The "Why This Matters" bullets, cited.'),
  caveats: z.array(citedTextSchema).describe('The "Caveats" bullets, cited.'),
  quoteSourceId: z.string().nullable().describe('Id of the source the key quote comes from.'),
  sources: z.array(researchedSourceSchema).describe('The cited sources: the original article first, earlier Actually Relevant stories last.'),
})

export type ResearchedStory = z.infer<typeof researchedStorySchema>
export type ResearchedSource = z.infer<typeof researchedSourceSchema>
export type Citation = z.infer<typeof citationSchema>
export type CitedText = z.infer<typeof citedTextSchema>

/** What the projection is built from: a run's draft, sources and earlier stories. */
export interface ResearchRunForReaders {
  draft: Pick<Draft, 'story' | 'whyThisMatters' | 'caveats' | 'quoteSourceId'>
  sources: ResearchSource[]
  earlier: ResearchEarlier[]
}

const sourceIdOf = (factId: string) => factId.replace(/F\d+$/, '')

/**
 * Every fact id the writer could cite, with its supporting sentence: the sources' and earlier
 * stories' facts, and each one's publication date (`S2F0`, `publishedFact`), which has none.
 */
function factPool(run: ResearchRunForReaders): Map<string, string> {
  const facts = [
    ...run.sources.flatMap(s => [...s.facts, ...publishedFact(s.id, s.outlet, s.date)]),
    ...run.earlier.flatMap(e => [...e.facts, ...publishedFact(e.id, OUR_OUTLET, e.date)]),
  ]
  return new Map(facts.map(f => [f.id, f.supportingSentence]))
}

/** One citation per source, in first-cited order, each with that source's first supporting sentence. */
function cite(item: { text: string; factIds: string[] }, pool: ReadonlyMap<string, string>): CitedText {
  const bySource = new Map<string, Citation>()
  for (const factId of item.factIds) {
    const sentence = pool.get(factId)
    if (sentence === undefined) continue
    const sourceId = sourceIdOf(factId)
    const known = bySource.get(sourceId)
    if (!known) bySource.set(sourceId, { sourceId, sentence: sentence || null })
    else if (known.sentence === null && sentence) known.sentence = sentence
  }
  return { text: item.text, citations: [...bySource.values()] }
}

/** The host of an http(s) address, without `www.`; null for any other address. */
function hostOf(url: string): string | null {
  return httpUrl(url)?.hostname.replace(/^www\./, '') || null
}

function fromSource(s: ResearchSource): ResearchedSource {
  const host = hostOf(s.url)
  return {
    id: s.id,
    origin: s.origin === 'original' ? 'original' : 'source',
    outlet: s.outlet,
    host,
    url: host ? s.url : null,
    title: s.title,
    date: s.date,
    country: s.country && s.country !== 'unknown' ? s.country : null,
    kind: s.kind,
    storyId: null,
    slug: null,
  }
}

function fromEarlier(e: ResearchEarlier): ResearchedSource {
  return {
    id: e.id,
    origin: 'earlier',
    outlet: OUR_OUTLET,
    host: null,
    url: null,
    title: e.title,
    date: e.date,
    country: null,
    kind: null,
    storyId: e.storyId,
    slug: e.slug,
  }
}

const allCited = (story: Pick<ResearchedStory, 'paragraphs' | 'whyThisMatters' | 'caveats'>): CitedText[] => [
  ...story.paragraphs.flatMap(p => p.sentences),
  ...story.whyThisMatters,
  ...story.caveats,
]

/**
 * The reader's version of a run: its cited text, and only the sources something cites (the quote's
 * included). The original article is always listed first and our earlier stories last.
 */
export function buildResearchedStory(run: ResearchRunForReaders): ResearchedStory {
  const pool = factPool(run)
  const text = {
    paragraphs: run.draft.story.map(p => ({ sentences: p.sentences.map(s => cite(s, pool)) })),
    whyThisMatters: run.draft.whyThisMatters.map(b => cite(b, pool)),
    caveats: run.draft.caveats.map(b => cite(b, pool)),
  }
  const known = new Set([...run.sources.map(s => s.id), ...run.earlier.map(e => e.id)])
  const quoteSourceId = known.has(run.draft.quoteSourceId) ? run.draft.quoteSourceId : null
  const cited = new Set([...allCited(text).flatMap(t => t.citations.map(c => c.sourceId)), ...(quoteSourceId ? [quoteSourceId] : [])])
  const sources = [...run.sources.filter(s => s.origin === 'original'), ...run.sources.filter(s => s.origin !== 'original' && cited.has(s.id))].map(fromSource)
  return { ...text, quoteSourceId, sources: [...sources, ...run.earlier.filter(e => cited.has(e.id)).map(fromEarlier)] }
}

/** The ids of the earlier stories the projection cites, for the read-time lookup. */
export function earlierStoryIds(research: ResearchedStory): string[] {
  return research.sources.flatMap(s => (s.origin === 'earlier' && s.storyId ? [s.storyId] : []))
}

/**
 * The projection as readers get it now: an earlier story that is no longer published leaves with
 * its citations (and as the quote's source), and each remaining one takes its current slug.
 * `publishedSlugs` maps the earlier stories still published to their slugs.
 */
export function forReaders(research: ResearchedStory, publishedSlugs: ReadonlyMap<string, string>): ResearchedStory {
  const slugOf = (s: ResearchedSource) => (s.origin === 'earlier' && s.storyId ? publishedSlugs.get(s.storyId) : undefined)
  const gone = new Set(research.sources.filter(s => s.origin === 'earlier' && slugOf(s) === undefined).map(s => s.id))
  const keep = (t: CitedText): CitedText => ({ ...t, citations: t.citations.filter(c => !gone.has(c.sourceId)) })
  return {
    paragraphs: research.paragraphs.map(p => ({ sentences: p.sentences.map(keep) })),
    whyThisMatters: research.whyThisMatters.map(keep),
    caveats: research.caveats.map(keep),
    quoteSourceId: research.quoteSourceId && gone.has(research.quoteSourceId) ? null : research.quoteSourceId,
    sources: research.sources.filter(s => !gone.has(s.id)).map(s => ({ ...s, slug: slugOf(s) ?? s.slug })),
  }
}

/** The story's text without citations: the sentences of each paragraph joined, paragraphs apart. */
export function researchedStoryText(research: Pick<ResearchedStory, 'paragraphs'>): string {
  return research.paragraphs.map(p => p.sentences.map(s => s.text).join(' ')).join('\n\n')
}

/** The text of a stored version (`stories.research`); null without one, or for one that fails its schema, as the story page then serves none. */
export function storedResearchText(stored: unknown): string | null {
  const parsed = researchedStorySchema.safeParse(stored)
  return parsed.success ? researchedStoryText(parsed.data) : null
}
