/**
 * The answer keys against the database (the `keys` step of `eval:overviews`): every slug a key names
 * is a published story, each entry's date is its publication day (UTC), and every value's quote
 * occurs in that story's published text. A miss is an error in the key, to fix there, never a pass
 * or fail of anything in production. Also the per-development counts the report shows. The loader
 * issues one SELECT through the read-only session; the rest is pure but for the loader it is given.
 */
import { storedResearchText } from '../../../services/researchedStory.js'
import type { SelectDb } from '../readOnlyDb.js'
import type { KeyFile } from './keyFiles.js'
import type { AnswerKey } from './keySchema.js'

/** A story a key names, as the check reads it. */
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
}

interface KeyStoryRow {
  slug: string
  status: string
  date_published: Date | null
  title: string | null
  summary: string | null
  relevance_reasons: string | null
  antifactors: string | null
  research: unknown
  has_run: boolean
}

/** Every slug the key names (entries, near misses), once, in key order. */
export function keySlugs(key: AnswerKey): string[] {
  return [...new Set([...key.entries.map(e => e.slug), ...key.nearMisses.map(n => n.slug)])]
}

export async function loadKeyStories(db: SelectDb, slugs: string[]): Promise<Map<string, KeyStory>> {
  const rows = await db.$queryRaw<KeyStoryRow[]>`
    SELECT s.slug, s.status::text AS status, s.date_published, s.title, s.summary, s.relevance_reasons, s.antifactors, s.research,
           EXISTS (SELECT 1 FROM story_research_runs r WHERE r.story_id = s.id AND r.result IS NOT NULL) AS has_run
    FROM stories s
    WHERE s.slug = ANY(${slugs})`
  return new Map(
    rows.map(r => [
      r.slug,
      {
        slug: r.slug,
        status: r.status,
        datePublished: r.date_published,
        title: r.title,
        summary: r.summary,
        relevanceReasons: r.relevance_reasons,
        antifactors: r.antifactors,
        research: r.research,
        hasResearchRun: r.has_run,
      },
    ]),
  )
}

/** Whitespace runs to one space, curly and angle quote marks to straight ones, every dash to a hyphen. Case and words stay. */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[‘’‚‛′‹›`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The story's published text, field by field: title, summary, relevance reasons, antifactors, and the applied research's paragraphs. */
export function publishedTexts(story: Pick<KeyStory, 'title' | 'summary' | 'relevanceReasons' | 'antifactors' | 'research'>): string[] {
  return [story.title, story.summary, story.relevanceReasons, story.antifactors, storedResearchText(story.research)].filter((t): t is string => !!t)
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

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
  for (const e of key.entries) {
    const s = published('entry', e.slug)
    if (!s?.datePublished) continue
    if (utcDay(s.datePublished) !== e.date) errors.push(`entry ${e.slug}: dated ${e.date}, published ${utcDay(s.datePublished)} (UTC)`)
    const texts = publishedTexts(s).map(normalizeQuote)
    for (const v of e.values) {
      const quote = normalizeQuote(v.quote)
      if (!texts.some(t => t.includes(quote))) errors.push(`entry ${e.slug}: quote not found: "${v.quote}"`)
    }
  }
  for (const n of key.nearMisses) published('near miss', n.slug)
  return errors
}

export interface KeySummary {
  id: string
  title: string
  must: number
  optional: number
  nearMisses: number
  figures: number
  values: number
  /** The day it ended, or null while open. */
  closed: string | null
  /** Entry stories with a stored research run. */
  withResearchRun: number
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
    closed: key.closed?.date ?? null,
    withResearchRun: key.entries.filter(e => stories.get(e.slug)?.hasResearchRun).length,
  }
}

/** One answer-key file's result: its counts when it parsed, and every error, its own (format) first, then the database's. */
export interface KeyResult {
  file: string
  summary: KeySummary | null
  errors: string[]
}

/** The `keys` step: every parsed key against the stories it names, loaded once for all of them. */
export async function checkKeyFiles(files: KeyFile[], loadStories: (slugs: string[]) => Promise<ReadonlyMap<string, KeyStory>>): Promise<KeyResult[]> {
  const slugs = [...new Set(files.flatMap(f => (f.key ? keySlugs(f.key) : [])))]
  const stories = slugs.length === 0 ? new Map<string, KeyStory>() : await loadStories(slugs)
  return files.map(f => ({
    file: f.file,
    summary: f.key ? summarizeKey(f.key, stories) : null,
    errors: [...f.errors, ...(f.key ? checkKey(f.key, stories) : [])],
  }))
}
