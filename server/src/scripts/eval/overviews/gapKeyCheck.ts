/**
 * The gap keys against the database (the `gap-keys` step of `eval:overviews`): every slug a key
 * names is a published story, the key's date is its UTC publication day, the story has a completed
 * research run whose sources hold facts (what the `context` step replays), and every `inStory`
 * quote occurs in its published text after `normalizeQuote`, as the answer keys' quotes are found.
 * A miss is an error in the key, to fix there; it passes or fails nothing in production. Also each
 * key's counts and its half for the report. The loader issues one SELECT through the read-only
 * session; the rest is pure.
 */
import type { SelectDb } from '../readOnlyDb.js'
import { halfOf, type Half } from './contextScore.js'
import type { GapKey } from './gapKeySchema.js'
import type { GapKeyFile } from './keyFiles.js'
import { normalizeQuote, publishedTexts, type KeyStory } from './keyCheck.js'

/** A story a gap key names, as the check reads it. */
export interface GapKeyStory extends Omit<KeyStory, 'hasResearchRun'> {
  /** A completed research run whose sources hold facts exists: the run the `context` step loads. */
  hasResearchFacts: boolean
}

interface GapKeyStoryRow {
  slug: string
  status: string
  date_published: Date | null
  title: string | null
  summary: string | null
  relevance_reasons: string | null
  antifactors: string | null
  research: unknown
  has_facts: boolean
}

export async function loadGapKeyStories(db: SelectDb, slugs: string[]): Promise<Map<string, GapKeyStory>> {
  const rows = await db.$queryRaw<GapKeyStoryRow[]>`
    SELECT s.slug, s.status::text AS status, s.date_published, s.title, s.summary, s.relevance_reasons, s.antifactors, s.research,
           EXISTS (
             SELECT 1 FROM story_research_runs r
             WHERE r.story_id = s.id AND r.status = 'completed' AND jsonb_path_exists(r.result, '$.sources[*].facts[*]')
           ) AS has_facts
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
        hasResearchFacts: r.has_facts,
      },
    ]),
  )
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

/** What the database contradicts in the key; empty when it holds. */
export function checkGapKey(key: GapKey, stories: ReadonlyMap<string, GapKeyStory>): string[] {
  const s = stories.get(key.slug)
  if (!s) return [`${key.slug}: no story with this slug`]
  if (s.status !== 'published' || !s.datePublished) return [`${key.slug}: not published (status ${s.status})`]
  const errors: string[] = []
  if (utcDay(s.datePublished) !== key.date) errors.push(`dated ${key.date}, published ${utcDay(s.datePublished)} (UTC)`)
  if (!s.hasResearchFacts) errors.push('no completed research run whose sources hold facts: the context step has nothing to replay')
  const texts = publishedTexts(s).map(normalizeQuote)
  for (const n of key.needs) {
    if (n.inStory !== null && !texts.some(t => t.includes(normalizeQuote(n.inStory!)))) errors.push(`need ${n.id}: inStory not found: "${n.inStory}"`)
  }
  return errors
}

/** How the key's response need stands: our story reports it, a source the drafter found reports it, or none does. */
export type ResponseKind = 'in-story' | 'findable' | 'no-source'

export interface GapKeySummary {
  slug: string
  title: string
  half: Half
  needs: number
  must: number
  /** Must needs our story does not already state: what recall counts. */
  openMust: number
  response: ResponseKind
}

export function summarizeGapKey(key: GapKey): GapKeySummary {
  const response = key.needs.find(n => n.slot === 'response' && n.importance === 'must')
  return {
    slug: key.slug,
    title: key.title,
    half: halfOf(key.slug),
    needs: key.needs.length,
    must: key.needs.filter(n => n.importance === 'must').length,
    openMust: key.needs.filter(n => n.importance === 'must' && n.inStory === null).length,
    response: response && response.inStory !== null ? 'in-story' : response && response.example !== null ? 'findable' : 'no-source',
  }
}

/** One gap-key file's result: its counts when it parsed, and every error, its own (format) first, then the database's. */
export interface GapKeyResult {
  file: string
  summary: GapKeySummary | null
  errors: string[]
}

/** The `gap-keys` step: every parsed key against its story, loaded once for all of them. */
export async function checkGapKeyFiles(
  files: GapKeyFile[],
  loadStories: (slugs: string[]) => Promise<ReadonlyMap<string, GapKeyStory>>,
): Promise<GapKeyResult[]> {
  const slugs = [...new Set(files.flatMap(f => (f.key ? [f.key.slug] : [])))]
  const stories = slugs.length === 0 ? new Map<string, GapKeyStory>() : await loadStories(slugs)
  return files.map(f => ({
    file: f.file,
    summary: f.key ? summarizeGapKey(f.key) : null,
    errors: [...f.errors, ...(f.key ? checkGapKey(f.key, stories) : [])],
  }))
}
