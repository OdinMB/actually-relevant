/**
 * The answer keys against the database (the `keys` step of `eval:overviews`): every slug a key names
 * is a published story, each entry's date is its publication day (UTC), and every quote (a value's,
 * a response's) occurs in that story's published text. A miss is an error in the key, to
 * fix there, never a pass or fail of anything in production. Also the per-development counts the
 * report shows, the drafts still to review among them, and the stories two keys both hold as must
 * (the linking eval counts either one's overview as right for them). The loader
 * issues one SELECT through the read-only session; the rest is pure but for the loader it is given.
 */
import { utcDay } from '../../../lib/days.js'
import { normalizeQuote } from '../../../lib/quoteMatch.js'
import { storedResearchText } from '../../../services/researchedStory.js'
import type { SelectDb } from '../readOnlyDb.js'
import type { KeyFile } from './keyFiles.js'
import { unreviewed, type AnswerKey } from './keySchema.js'
import { sharedMusts } from './linkScore.js'

/** A story an answer key or a gap key names, as the checks read it. */
export interface KeyStory {
  slug: string
  status: string
  datePublished: Date | null
  title: string | null
  summary: string | null
  relevanceReasons: string | null
  antifactors: string | null
  /** `stories.research`: the applied research's cited version, null for a single-source story. */
  research: unknown
  /** Whether a research run with a stored result exists for the story (what module 1's replay reads). */
  hasResearchRun: boolean
  /** A completed research run whose sources hold facts exists: the run the gap keys' `context` step loads. */
  hasResearchFacts: boolean
}

/** Every slug the key names (entries, near misses, then its centers'), once, in key order. */
export function keySlugs(key: AnswerKey): string[] {
  return [
    ...new Set([
      ...key.entries.map(e => e.slug),
      ...key.nearMisses.map(n => n.slug),
      ...key.centers.flatMap(c => [...c.entries.map(e => e.slug), ...c.nearMisses.map(n => n.slug)]),
    ]),
  ]
}

/** The stories the slugs name, for the answer keys' and the gap keys' checks alike: one SELECT through the read-only session. */
export async function loadKeyStories(db: SelectDb, slugs: string[]): Promise<Map<string, KeyStory>> {
  const rows = await db.$queryRaw<KeyStory[]>`
    SELECT s.slug, s.status::text AS status, s.date_published AS "datePublished", s.title, s.summary, s.relevance_reasons AS "relevanceReasons",
           s.antifactors, s.research,
           EXISTS (SELECT 1 FROM story_research_runs r WHERE r.story_id = s.id AND r.result IS NOT NULL) AS "hasResearchRun",
           EXISTS (
             SELECT 1 FROM story_research_runs r
             WHERE r.story_id = s.id AND r.status = 'completed' AND jsonb_path_exists(r.result, '$.sources[*].facts[*]')
           ) AS "hasResearchFacts"
    FROM stories s
    WHERE s.slug = ANY(${slugs})`
  return new Map(rows.map(r => [r.slug, r]))
}

type PublishedStory = Pick<KeyStory, 'title' | 'summary' | 'relevanceReasons' | 'antifactors' | 'research'>

/** The story's published text, field by field and named as the drafting prompt shows it; empty fields left out. */
export function publishedFields(story: PublishedStory): { name: string; text: string }[] {
  const fields: [string, string | null][] = [
    ['TITLE', story.title],
    ['SUMMARY', story.summary],
    ['WHY_IT_MATTERS', story.relevanceReasons],
    ['CAVEATS', story.antifactors],
    ['RESEARCHED_TEXT', storedResearchText(story.research)],
  ]
  return fields.flatMap(([name, text]) => (text ? [{ name, text }] : []))
}

/** The story's published text, field by field: title, summary, relevance reasons, antifactors, and the applied research's paragraphs. */
export function publishedTexts(story: PublishedStory): string[] {
  return publishedFields(story).map(f => f.text)
}

/** What the database contradicts in the key; empty when it holds. */
export function checkKey(key: AnswerKey, stories: ReadonlyMap<string, KeyStory>): string[] {
  const errors: string[] = []
  const published = (what: string, slug: string): KeyStory | null => {
    const s = stories.get(slug)
    if (!s) errors.push(`${what} ${slug}: no story with this slug`)
    else if (s.status !== 'published' || !s.datePublished) errors.push(`${what} ${slug}: not published (status ${s.status})`)
    else return s
    return null
  }
  const centers = key.centers.map(c => ({ ...c, at: `center "${c.title}" ` }))
  for (const { at, ...e } of [...key.entries.map(e => ({ ...e, at: '' })), ...centers.flatMap(c => c.entries.map(e => ({ ...e, at: c.at })))]) {
    const s = published(`${at}entry`, e.slug)
    if (!s?.datePublished) continue
    if (utcDay(s.datePublished) !== e.date) errors.push(`${at}entry ${e.slug}: dated ${e.date}, published ${utcDay(s.datePublished)} (UTC)`)
    const texts = publishedTexts(s).map(normalizeQuote)
    for (const v of e.values) {
      const quote = normalizeQuote(v.quote)
      if (!texts.some(t => t.includes(quote))) errors.push(`${at}entry ${e.slug}: quote not found: "${v.quote}"`)
    }
  }
  for (const n of key.nearMisses) published('near miss', n.slug)
  for (const c of centers) for (const n of c.nearMisses) published(`${c.at}near miss`, n.slug)
  const quoted = [...key.responses.map(r => ({ field: 'response', ...r })), ...centers.flatMap(c => c.responses.map(r => ({ field: `${c.at}response`, ...r })))]
  for (const q of quoted) {
    const s = q.slug && q.quote ? stories.get(q.slug) : undefined
    if (!s || !q.quote) continue
    if (!statesQuote(s, q.quote)) errors.push(`${q.field} ${q.slug}: quote not found: "${q.quote}"`)
  }
  return errors
}

/** Whether one field of the story's published text holds the quote, after `normalizeQuote` on both. */
export function statesQuote(story: PublishedStory, quote: string): boolean {
  const wanted = normalizeQuote(quote)
  return publishedTexts(story).some(t => normalizeQuote(t).includes(wanted))
}

export interface KeySummary {
  id: string
  title: string
  must: number
  optional: number
  nearMisses: number
  figures: number
  values: number
  responses: number
  /** Entry stories with a stored research run. */
  withResearchRun: number
  /** Drafted responses and centers a person has not reviewed yet (`unreviewed`). */
  toReview: number
}

export function summarizeKey(key: AnswerKey, stories: ReadonlyMap<string, KeyStory>): KeySummary {
  return {
    id: key.id,
    title: key.title,
    must: key.entries.filter(e => e.join === 'must').length,
    optional: key.entries.filter(e => e.join === 'optional').length,
    nearMisses: key.nearMisses.length,
    figures: key.figures.length,
    values: key.entries.reduce((sum, e) => sum + e.values.length, 0),
    responses: key.responses.length,
    withResearchRun: key.entries.filter(e => stories.get(e.slug)?.hasResearchRun).length,
    toReview: unreviewed(key, 'responses') + unreviewed(key, 'centers'),
  }
}

/** One answer-key file's result: its counts when it parsed, and every error, its own (format) first, then the database's. */
export interface KeyResult {
  file: string
  summary: KeySummary | null
  errors: string[]
  /** Its must entries that another key holds as must too, with every key holding each (`sharedMusts`): not an error, listed so each one is a deliberate call. */
  sharedMusts: { slug: string; keys: string[] }[]
}

/** The `keys` step: every parsed key against the stories it names, loaded once for all of them. */
export async function checkKeyFiles(files: KeyFile[], loadStories: (slugs: string[]) => Promise<ReadonlyMap<string, KeyStory>>): Promise<KeyResult[]> {
  const slugs = [...new Set(files.flatMap(f => (f.key ? keySlugs(f.key) : [])))]
  const stories = slugs.length === 0 ? new Map<string, KeyStory>() : await loadStories(slugs)
  const shared = sharedMusts(files.flatMap(f => (f.key ? [f.key] : [])))
  return files.map(f => ({
    file: f.file,
    summary: f.key ? summarizeKey(f.key, stories) : null,
    errors: [...f.errors, ...(f.key ? checkKey(f.key, stories) : [])],
    sharedMusts: f.key ? shared.filter(s => s.keys.includes(f.key!.id)) : [],
  }))
}
