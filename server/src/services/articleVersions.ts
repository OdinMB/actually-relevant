/**
 * A story's article versions as state (`.context/research-passes.md`, "Versions and Updates"): the
 * article a version holds, each section with its cited pool facts (read from the projection's
 * citations for a legacy version, which stored none); each section's cited text as readers see it;
 * the next version a later pass makes, whose projection keeps every section it did not rewrite as
 * readers saw it; and the Updates readers get from a story's versions. Pure: the undo and the reverts
 * are written by `articleVersionWrites.ts`.
 */
import { utcDay } from '../lib/days.js'
import { EMOTION_TAGS } from '../schemas/llm.js'
import type { Draft } from '../schemas/research.js'
import { draftItems, LABELS } from './researchChecks.js'
import type { Citation, CitedText, ResearchedSource, ResearchedStory } from './researchedStory.js'
import type { ArticleText } from './researchPipeline.js'
import type { Article, ArticleVersionData, Pool, VersionChange, VersionFields } from './researchPool.js'
import { researchedValues } from './researchSwap.js'

/** A draft's published fields with their cited facts: the article a version keeps. */
export function articleOf(draft: Pick<Draft, keyof ArticleText | 'emotionTag'>): Article {
  return {
    titleLabel: draft.titleLabel,
    title: draft.title,
    story: draft.story,
    summary: draft.summary,
    whyThisMatters: draft.whyThisMatters,
    caveats: draft.caveats,
    quote: draft.quote,
    quoteAttribution: draft.quoteAttribution,
    quoteSourceId: draft.quoteSourceId,
    marketingBlurb: draft.marketingBlurb,
    emotionTag: draft.emotionTag,
  }
}

/** A paragraph's passages as one (one since 2026-11-13; one a sentence before), citing each source once. */
function merged(parts: CitedText[]): CitedText {
  const bySource = new Map<string, Citation>()
  for (const c of parts.flatMap(p => p.citations)) {
    const known = bySource.get(c.sourceId)
    if (!known) bySource.set(c.sourceId, { ...c })
    else if (known.sentence === null && c.sentence) known.sentence = c.sentence
  }
  return { text: parts.map(p => p.text).join(' '), citations: [...bySource.values()] }
}

/**
 * The facts a legacy section's citations name: per citation, the source's fact whose supporting
 * sentence it shows, or its date fact (`S2F0`) for one that shows none. Readers see one citation per
 * source, so a section's other facts of that source are not known; a citation the pool lacks names
 * none (less evidence, never a failure).
 */
function citedFacts(citations: Citation[], facts: Pool['facts']): string[] {
  return citations.flatMap(c => {
    if (c.sentence === null) return [`${c.sourceId}F0`]
    return facts.find(f => f.sourceRef === c.sourceId && f.supportingSentence === c.sentence)?.ref ?? []
  })
}

const emotionTagOf = (tag: string | null): Article['emotionTag'] =>
  (EMOTION_TAGS as readonly string[]).includes(tag ?? '') ? (tag as Article['emotionTag']) : undefined

/** The article a version holds: the one it stored, or for a legacy version, its text with the facts its citations name. */
export function versionArticle(version: ArticleVersionData, pool: Pick<Pool, 'facts'>): Article {
  if (version.article) return version.article
  const r = version.research
  const cited = (t: CitedText) => ({ text: t.text, factIds: citedFacts(t.citations, pool.facts) })
  return {
    titleLabel: version.titleLabel ?? '',
    title: version.title ?? '',
    story: r.paragraphs.map(p => cited(merged(p.sentences))),
    summary: version.summary ?? '',
    whyThisMatters: r.whyThisMatters.map(cited),
    caveats: r.caveats.map(cited),
    quote: version.quote ?? '',
    quoteAttribution: version.quoteAttribution ?? '',
    quoteSourceId: r.quoteSourceId ?? '',
    marketingBlurb: version.marketingBlurb ?? '',
    emotionTag: emotionTagOf(version.emotionTag),
  }
}

const uncited = (text: string): CitedText => ({ text, citations: [] })

/** Each section of the article as readers see it, by its label (`draftItems`): the paragraphs and bullets with the projection's citations, the title, summary and blurb citing nothing. */
export function sectionTexts(article: ArticleText, research: ResearchedStory): Map<string, CitedText> {
  const parts = {
    story: research.paragraphs.map(p => merged(p.sentences)),
    whyThisMatters: research.whyThisMatters,
    caveats: research.caveats,
  }
  return new Map(
    draftItems(article).map(item => {
      if (!item.cited) return [item.label, uncited(item.text)]
      const index = Number(/(\d+)$/.exec(item.label)?.[1]) - 1
      return [item.label, parts[item.part as keyof typeof parts][index] ?? uncited(item.text)]
    }),
  )
}

/** Where each kept item of a part sits before and after the drops: the `from`th of the old list is the `to`th of the new. */
export interface Kept {
  part: keyof typeof LABELS
  from: number
  to: number
}

/**
 * The next version's projection: `next`, built from the pool for the new article, with every section
 * `frozen` names taken from `old` as readers saw it, its citations included, so a section no change
 * touched is the same byte for byte; the sources are those something cites, the original first and
 * our earlier stories last, as a projection lists them.
 */
export function withFrozen(next: ResearchedStory, old: ResearchedStory, frozen: Kept[]): ResearchedStory {
  const story = { paragraphs: [...next.paragraphs], whyThisMatters: [...next.whyThisMatters], caveats: [...next.caveats] }
  for (const k of frozen) {
    if (k.part === 'story') {
      const p = old.paragraphs[k.from]
      if (p) story.paragraphs[k.to] = p
    } else {
      const t = old[k.part][k.from]
      if (t) story[k.part][k.to] = t
    }
  }
  const all = [...story.paragraphs.flatMap(p => p.sentences), ...story.whyThisMatters, ...story.caveats]
  const cited = new Set([...all.flatMap(t => t.citations.map(c => c.sourceId)), ...(next.quoteSourceId ? [next.quoteSourceId] : [])])
  const known = new Map<string, ResearchedSource>([...old.sources, ...next.sources].map(s => [s.id, s]))
  const listed = [...known.values()].filter(s => s.origin === 'original' || cited.has(s.id))
  return {
    ...story,
    quoteSourceId: next.quoteSourceId,
    sources: [...listed.filter(s => s.origin === 'original'), ...listed.filter(s => s.origin === 'source'), ...listed.filter(s => s.origin === 'earlier')],
  }
}

/** The columns a version writes into the story: the article's, keeping the version before's emotion tag when the article has none. */
function fieldsOf(article: Article, emotionTag: string | null): VersionFields {
  const v = researchedValues(article)
  return {
    title: v.title,
    titleLabel: v.titleLabel,
    summary: v.summary,
    marketingBlurb: v.marketingBlurb,
    quote: v.quote,
    quoteAttribution: v.quoteAttribution,
    relevanceReasons: v.relevanceReasons,
    antifactors: v.antifactors,
    emotionTag: v.emotionTag ?? emotionTag,
  }
}

/** What a later pass that rewrote the article makes of it. */
export interface NextVersion {
  passId: string
  article: Article
  research: ResearchedStory
  changes: VersionChange[]
  note: CitedText
}

/** The update a later pass makes, after `current`; its number is the next free one, which the store assigns. */
export function nextVersion(current: ArticleVersionData, next: NextVersion): ArticleVersionData {
  return {
    id: null,
    number: current.number + 1,
    kind: 'update',
    status: 'current',
    passId: next.passId,
    ...fieldsOf(next.article, current.emotionTag),
    research: next.research,
    article: next.article,
    changes: next.changes,
    note: next.note,
  }
}

/** The sections readers see on the story page: the headline, the paragraphs, the key quote and the bullets; the summary and the blurb stay in the admin. */
export const isPageSection = (label: string): boolean => label !== 'Summary' && label !== 'Blurb'

/** One Update as readers get it: its day, its note, and each changed section shown on the page with its earlier text. */
export interface PublicUpdate {
  /** `YYYY-MM-DD`, the day the version was made: code dates it, never the model. */
  date: string
  note: CitedText
  changes: { section: string; before: CitedText | null }[]
}

/**
 * The Updates of a story, newest first: every version with a note that is not reverted (an update,
 * or a first pass's on a story already published), with the page's sections among its changes. An
 * undone update is reverted, and leaves the list.
 */
export function publicUpdates(versions: (Pick<ArticleVersionData, 'number' | 'kind' | 'status' | 'changes' | 'note'> & { createdAt: Date })[]): PublicUpdate[] {
  return versions
    .filter(v => v.status !== 'reverted' && v.kind !== 'legacy' && v.note !== null)
    .sort((a, b) => b.number - a.number)
    .map(v => ({
      date: utcDay(v.createdAt),
      note: v.note!,
      changes: v.changes.filter(c => isPageSection(c.section)).map(c => ({ section: c.section, before: c.before })),
    }))
}
