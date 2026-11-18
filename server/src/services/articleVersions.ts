/**
 * A story's article versions as state (`.context/research-passes.md`, "Versions and Updates"): the
 * article a version holds, each section with its cited pool facts (read from the projection's
 * citations for a legacy version, which stored none); each section's cited text as readers see it;
 * the next version a later pass makes, whose projection keeps every section it did not rewrite as
 * readers saw it; which version an undo restores and the columns it writes back; and the Updates
 * readers get from a story's versions, with the sources they cite. Pure: the undo and the reverts are
 * written by `researchWrites.ts`.
 */
import { z } from 'zod'
import { utcDay } from '../lib/days.js'
import { EMOTION_TAGS } from '../schemas/llm.js'
import type { Draft } from '../schemas/research.js'
import { draftItems, LABELS } from './researchChecks.js'
import { citedTextSchema, researchedSourceSchema, type Citation, type CitedText, type ResearchedSource, type ResearchedStory } from './researchedStory.js'
import type { ArticleText } from './researchPipeline.js'
import type { Article, ArticleVersionData, Pool, VersionChange, VersionFields } from './researchPool.js'
import { researchedValues, type SwappedValues } from './researchSwap.js'

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

/** What a source is, whatever id a projection gave it: an earlier story by its id, any other by its address, or its outlet and headline without one. */
const sourceKey = (s: ResearchedSource) => (s.origin === 'earlier' ? `earlier:${s.storyId}` : s.url ? `url:${s.url}` : `named:${s.outlet}\n${s.title}`)

/** A maker of ids no projection source has: the id's letters with the next number free for them. */
function freshIds(taken: string[]): (id: string) => string {
  const top = new Map<string, number>()
  for (const id of taken) {
    const m = /^(\D+)(\d+)$/.exec(id)
    if (m) top.set(m[1]!, Math.max(top.get(m[1]!) ?? 0, Number(m[2])))
  }
  return id => {
    const letters = /^\D+/.exec(id)?.[0] ?? 'S'
    const n = (top.get(letters) ?? 0) + 1
    top.set(letters, n)
    return `${letters}${n}`
  }
}

/**
 * The ids of `next`'s sources that `old` gives to another source, each with the new id it is cited
 * under in the next version: none where both name the same source, or the pool's ids are the old
 * version's, as they are once a pass made it. Deterministic, so the note and the projection agree.
 */
export function sourceRenames(next: Pick<ResearchedStory, 'sources'>, old: Pick<ResearchedStory, 'sources'>): ReadonlyMap<string, string> {
  const oldById = new Map(old.sources.map(s => [s.id, s]))
  const fresh = freshIds([...old.sources, ...next.sources].map(s => s.id))
  const renamed = new Map<string, string>()
  for (const s of next.sources) {
    const kept = oldById.get(s.id)
    if (kept && sourceKey(kept) !== sourceKey(s)) renamed.set(s.id, fresh(s.id))
  }
  return renamed
}

/** The text with its citations under the renamed ids; the very object when none is renamed. */
export function renameCited(t: CitedText, renamed: ReadonlyMap<string, string>): CitedText {
  if (!t.citations.some(c => renamed.has(c.sourceId))) return t
  return { ...t, citations: t.citations.map(c => ({ ...c, sourceId: renamed.get(c.sourceId) ?? c.sourceId })) }
}

/**
 * The next version's projection: `next`, built from the pool for the new article, with every section
 * `frozen` names taken from `old` as readers saw it, its citations included, so a section no change
 * touched is the same byte for byte; the sources are those something cites, the original first and
 * our earlier stories last, as a projection lists them.
 *
 * An id `old` lists keeps `old`'s source: a frozen section cites it, or the quote, which is never
 * rewritten, or an Update's earlier text. Where `next` gives that id to another source (a legacy
 * version's numbering is not the pool's), the rewritten sections cite it under an id of its own
 * (`sourceRenames`). `alsoCited` are texts the page shows beside the article (the Update note, its ids
 * renamed the same way, `renameCited`): their sources are listed too.
 */
export function withFrozen(next: ResearchedStory, old: ResearchedStory, frozen: Kept[], alsoCited: CitedText[] = []): ResearchedStory {
  const oldById = new Map(old.sources.map(s => [s.id, s]))
  const renamed = sourceRenames(next, old)
  const rename = (t: CitedText) => renameCited(t, renamed)
  const story = {
    paragraphs: next.paragraphs.map(p => (p.sentences.some(t => rename(t) !== t) ? { sentences: p.sentences.map(rename) } : p)),
    whyThisMatters: next.whyThisMatters.map(rename),
    caveats: next.caveats.map(rename),
  }
  for (const k of frozen) {
    if (k.part === 'story') {
      const p = old.paragraphs[k.from]
      if (p) story.paragraphs[k.to] = p
    } else {
      const t = old[k.part][k.from]
      if (t) story[k.part][k.to] = t
    }
  }
  const all = [...story.paragraphs.flatMap(p => p.sentences), ...story.whyThisMatters, ...story.caveats, ...alsoCited.map(rename)]
  const cited = new Set([...all.flatMap(t => t.citations.map(c => c.sourceId)), ...(next.quoteSourceId ? [next.quoteSourceId] : [])])
  const known = new Map<string, ResearchedSource>(oldById)
  for (const s of next.sources) {
    const id = renamed.get(s.id)
    if (id) known.set(id, { ...s, id })
    else if (!known.has(s.id)) known.set(s.id, s)
  }
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

/** A single-source story's text as readers see it: its headline, its summary as the story, and its bullet lists. */
export type SingleSourceText = Pick<VersionFields, 'title' | 'summary' | 'relevanceReasons' | 'antifactors'>

const bulletsOf = (text: string | null) =>
  (text ?? '')
    .split('\n')
    .map(line => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * The Update a first pass records on a story already published (plan, For Odin 5): the note, which
 * counts the outside sources the version cites ("Researched with 3 more sources on Nov 19; the story was
 * rewritten from them."), and the single-source text as it was, section by section under the page's
 * labels (its summary is the story's one paragraph), each beside the section that now has that label,
 * or none. Code words and dates it, never a model.
 */
export function firstPassUpdate(
  before: SingleSourceText,
  version: Pick<ArticleVersionData, 'research' | 'article'>,
  day: string,
): Pick<ArticleVersionData, 'changes' | 'note'> {
  const now = version.article ? sectionTexts(version.article, version.research) : new Map<string, CitedText>()
  const changes: VersionChange[] = []
  const add = (label: string, text: string | null) => {
    if (text) changes.push({ section: label, from: label, before: uncited(text), after: now.get(label) ?? null })
  }
  add('Title', before.title)
  add(LABELS.story(0), before.summary)
  bulletsOf(before.relevanceReasons).forEach((text, i) => add(LABELS.whyThisMatters(i), text))
  bulletsOf(before.antifactors).forEach((text, i) => add(LABELS.caveats(i), text))
  const n = version.research.sources.filter(s => s.origin === 'source').length
  const text =
    n === 0
      ? `Researched on ${dayLabel(day)}; the story was rewritten.`
      : `Researched with ${n} more source${n === 1 ? '' : 's'} on ${dayLabel(day)}; the story was rewritten from ${n === 1 ? 'it' : 'them'}.`
  return { changes, note: uncited(text) }
}

/**
 * The version a pass applies, as readers will get it (ADR-0068, owner 2026-11-18): Updates start
 * with the story's publication. A first pass on a story already published is one (`firstPassUpdate`);
 * a later pass's rewrite of a story readers do not have yet keeps its changes for the admin but no
 * note, so it is never an Update and marks nothing, also once the story is published.
 */
export function versionForReaders(
  version: ArticleVersionData,
  published: boolean,
  firstUpdate: () => Pick<ArticleVersionData, 'changes' | 'note'>,
): ArticleVersionData {
  if (!published) return version.kind === 'update' ? { ...version, note: null } : version
  return version.kind === 'first' ? { ...version, ...firstUpdate() } : version
}

/** The sections readers see on the story page: the headline, the paragraphs, the key quote and the bullets; the summary and the blurb stay in the admin. */
export const isPageSection = (label: string): boolean => label !== 'Summary' && label !== 'Blurb'

/**
 * One Update as readers get it: its day, its note, each changed section shown on the page with its
 * earlier text, labeled by where it was in the version before (unique among an Update's changes), and
 * whether the update removed it; and the sources the note and the earlier texts cite. The public
 * contract's shape (`GET /api/stories/{slug}`, `updates`).
 */
export const publicUpdateSchema = z.object({
  date: z.string().describe('The day the story was updated, `YYYY-MM-DD` (UTC).'),
  note: citedTextSchema.describe(
    'What changed and why, cited: written by an AI model and checked against its sources, or, when that note fails its checks, a fixed line naming the sections and outlets; on the first update of a story published before it was researched, a fixed line.',
  ),
  changes: z
    .array(
      z.object({
        section: z
          .string()
          .describe('Where the section was on the page before the update: `Title`, `Story paragraph 2`, `Key quote`, `Why This Matters 1`, `Caveat 2`.'),
        before: citedTextSchema.nullable().describe('The earlier text, with the citations it carried; null for a section the update added.'),
        removed: z.boolean().describe('Whether the update removed the section rather than rewrote it.'),
      }),
    )
    .describe('Each changed section shown on the story page, with its earlier text.'),
  sources: z.array(researchedSourceSchema).describe('The sources the note and the earlier texts cite, the original article first.'),
})

export type PublicUpdate = z.infer<typeof publicUpdateSchema>

const BY_ORIGIN: Record<ResearchedSource['origin'], number> = { original: 0, source: 1, earlier: 2 }

/**
 * The Updates of a story, newest first: every version with a note that is not reverted (an update,
 * or a first pass's on a story already published), with the page's sections among its changes. An
 * undone update is reverted, and leaves the list. Its sources are found in its own version's
 * projection, which lists what the note cites, else in the version it replaced (the newest earlier
 * one not reverted), whose text the earlier texts are; a pass keeps an id meaning one source across
 * the two (`withFrozen`). A citation neither lists is left out.
 */
export function publicUpdates(
  versions: (Pick<ArticleVersionData, 'number' | 'kind' | 'status' | 'changes' | 'note' | 'research'> & { createdAt: Date })[],
): PublicUpdate[] {
  const kept = versions.filter(v => v.status !== 'reverted').sort((a, b) => b.number - a.number)
  return kept.flatMap((v, i) => {
    if (v.kind === 'legacy' || v.note === null) return []
    const replaced = kept[i + 1]
    const known = new Map([...(replaced?.research.sources ?? []), ...v.research.sources].map(s => [s.id, s]))
    const listed = (t: CitedText): CitedText => ({ ...t, citations: t.citations.filter(c => known.has(c.sourceId)) })
    const note = listed(v.note)
    const changes = v.changes
      .filter(c => isPageSection(c.section))
      .map(c => ({ section: c.from, before: c.before && listed(c.before), removed: c.after === null }))
    const cited = new Set([...note.citations, ...changes.flatMap(c => c.before?.citations ?? [])].map(c => c.sourceId))
    const sources = [...known.values()].filter(s => cited.has(s.id)).sort((a, b) => BY_ORIGIN[a.origin] - BY_ORIGIN[b.origin])
    return [{ date: utcDay(v.createdAt), note, changes, sources }]
  })
}

/** The ids of the earlier stories the Updates cite, for the read-time lookup (`forReaders`'s). */
export const updatesEarlierStoryIds = (updates: PublicUpdate[]): string[] => [
  ...new Set(updates.flatMap(u => u.sources.flatMap(s => (s.origin === 'earlier' && s.storyId ? [s.storyId] : [])))),
]

/** The Updates as readers get them now: as `forReaders` serves the article, an earlier story no longer published leaves with its citations, and the rest take their current slugs. */
export function updatesForReaders(updates: PublicUpdate[], publishedSlugs: ReadonlyMap<string, string>): PublicUpdate[] {
  return updates.map(u => {
    const slugOf = (s: ResearchedSource) => (s.origin === 'earlier' && s.storyId ? publishedSlugs.get(s.storyId) : undefined)
    const gone = new Set(u.sources.filter(s => s.origin === 'earlier' && slugOf(s) === undefined).map(s => s.id))
    const keep = (t: CitedText): CitedText => ({ ...t, citations: t.citations.filter(c => !gone.has(c.sourceId)) })
    return {
      ...u,
      note: keep(u.note),
      changes: u.changes.map(c => ({ ...c, before: c.before && keep(c.before) })),
      sources: u.sources.filter(s => !gone.has(s.id)).map(s => ({ ...s, slug: slugOf(s) ?? s.slug })),
    }
  })
}

/**
 * What undoing the current version restores (an editor's "Undo this update"): the current version,
 * which must be an update, and the newest earlier one not reverted; else why there is nothing to undo.
 */
export function undoPlan<V extends Pick<ArticleVersionData, 'number' | 'kind' | 'status'>>(versions: V[]): { current: V; previous: V } | { refused: string } {
  const current = versions.find(v => v.status === 'current')
  if (!current) return { refused: 'This story has no current researched version' }
  if (current.kind !== 'update') return { refused: 'Only an update can be undone; the current version is the first researched one' }
  const previous = versions.filter(v => v.number < current.number && v.status === 'superseded').sort((a, b) => b.number - a.number)[0]
  if (!previous) return { refused: 'No earlier version is left to restore' }
  return { current, previous }
}

/** The story columns a version writes back, as an apply writes them; a version without a known emotion tag leaves the story's. */
export function versionValues(v: VersionFields): SwappedValues {
  const tag = emotionTagOf(v.emotionTag)
  return {
    title: v.title,
    titleLabel: v.titleLabel,
    summary: v.summary,
    quote: v.quote,
    quoteAttribution: v.quoteAttribution,
    marketingBlurb: v.marketingBlurb,
    relevanceReasons: v.relevanceReasons,
    relevanceSummary: null,
    antifactors: v.antifactors,
    ...(tag !== undefined && { emotionTag: tag }),
  }
}
