/**
 * The fact check's sample for `eval:overviews`: facts research already extracted, from the newest
 * finished runs in `story_research_runs.result` (the `StoryResearch` shape, `services/researchPipeline.ts`).
 * A fact qualifies when code found its supporting sentence in the source text (`found`) and its
 * statement states a significant number, the numbers the fact check's hints read. At most 10 facts
 * a run and 3 a source, taken round robin over the sources, and one run per story (its newest), so
 * the sample spreads over stories and outlets. SELECTs only, through the read-only session; the
 * picking is pure.
 */
import { z } from 'zod'
import { readNumbers, significant } from '../../../lib/numbers.js'
import type { ResearchFact, ResearchSource } from '../../../services/researchPipeline.js'
import type { ContextFactData } from '../../../services/storyContextChecks.js'
import type { ReadOnlyDb, SelectDb } from '../readOnlyDb.js'
import type { FieldPeers } from './plant.js'

export const MAX_FACTS_PER_RUN = 10
export const MAX_FACTS_PER_SOURCE = 3
/** 2: each fact carries its source's date. A cached sample of another version is resampled. */
export const FACT_FIXTURES_VERSION = 2

/** One extracted fact, with where it came from. */
export interface FactFixture {
  /** `<run id>:<fact id>`, unique in the sample. */
  key: string
  runId: string
  storyId: string | null
  sourceId: string
  outlet: string
  url: string
  /** The language of the feed the source was crawled from, when it is one of ours; null for a search result. */
  language: string | null
  /** The source's publication date as research stored it (ISO, or as search gave it); null when unknown. */
  date: string | null
  /** The extraction's statement, in English. */
  statement: string
  /** What the fact's figure counts, where and when, as the extraction recorded it. */
  measures: string
  /** The source's sentence, verbatim, in its own language. */
  sentence: string
  /**
   * Only for a module-1 fact (`--facts context` or `--facts pool`, `contextFacts.ts`): the fact as
   * run 1 kept it, which production renders, and the story's places and credited bodies; and the
   * title of our story the fact was researched for, which the fact check's second pass
   * (`factDrift.ts`) shows, beside the source's own headline, as what the article is about.
   */
  context?: { fact: ContextFactData; peers: FieldPeers; title: string }
}

export interface FactFixtures {
  version: typeof FACT_FIXTURES_VERSION
  createdAt: string
  /** The newest finished run's start: the sample is taken from there back. */
  anchor: string | null
  size: number
  dbClass: 'local' | 'remote'
  readOnlyMode: 'session' | 'transaction'
  facts: FactFixture[]
  /** Runs read to fill the sample, the skipped ones included. */
  runsRead: number
  /** Runs skipped because their result is in an older shape. */
  olderShape: number
  shortfalls: string[]
}

/** A run row as the sampler reads it: `result->'sources'` only. */
export interface RunRow {
  id: string
  story_id: string | null
  started_at: Date
  sources: unknown
}

type StoredSource = Pick<ResearchSource, 'id' | 'outlet' | 'url' | 'date'> & {
  facts: Pick<ResearchFact, 'id' | 'statement' | 'supportingSentence' | 'measures' | 'found'>[]
}

/** The part of `StoryResearch.sources` the sampler reads; a run that fails it is in an older shape. A source stored without a date is undated. */
const storedSourcesSchema: z.ZodType<StoredSource[], z.ZodTypeDef, unknown> = z.array(
  z.object({
    id: z.string(),
    outlet: z.string(),
    url: z.string(),
    date: z.string().nullable().default(null),
    facts: z.array(z.object({ id: z.string(), statement: z.string(), supportingSentence: z.string(), measures: z.string(), found: z.boolean() })),
  }),
)

/** Whether a statement states a number the fact check's hints would read. */
export const statesNumber = (statement: string): boolean => readNumbers(statement).some(significant)

/** A run's qualifying facts in sampling order; null for a run stored in an older shape. */
export function factsOfRun(row: RunRow): FactFixture[] | null {
  const parsed = storedSourcesSchema.safeParse(row.sources)
  if (!parsed.success) return null
  const perSource = parsed.data.map(s =>
    s.facts
      .filter(f => f.found && statesNumber(f.statement))
      .slice(0, MAX_FACTS_PER_SOURCE)
      .map(f => ({ s, f })),
  )
  const picked: FactFixture[] = []
  for (let round = 0; round < MAX_FACTS_PER_SOURCE; round++) {
    for (const facts of perSource) {
      const next = facts[round]
      if (!next || picked.length >= MAX_FACTS_PER_RUN) continue
      picked.push({
        key: `${row.id}:${next.f.id}`,
        runId: row.id,
        storyId: row.story_id,
        sourceId: next.s.id,
        outlet: next.s.outlet,
        url: next.s.url,
        language: null,
        date: next.s.date,
        statement: next.f.statement,
        measures: next.f.measures,
        sentence: next.f.supportingSentence,
      })
    }
  }
  return picked
}

export interface Picked {
  facts: FactFixture[]
  /** Rows consumed until the sample was full (or all of them). */
  runsRead: number
  olderShape: number
  /** Stories that gave facts so far, the ones passed in included. */
  stories: Set<string>
}

/** Facts from `rows` (newest first) up to `size`, skipping a story already in `stories`. */
export function pickFacts(rows: RunRow[], size: number, stories: ReadonlySet<string>): Picked {
  const out: Picked = { facts: [], runsRead: 0, olderShape: 0, stories: new Set(stories) }
  for (const row of rows) {
    if (out.facts.length >= size) break
    out.runsRead++
    const story = row.story_id ?? `run:${row.id}`
    if (out.stories.has(story)) continue
    const facts = factsOfRun(row)
    if (facts === null) {
      out.olderShape++
      continue
    }
    if (facts.length === 0) continue
    out.stories.add(story)
    out.facts.push(...facts.slice(0, size - out.facts.length))
  }
  return out
}

/** Runs read a query: each holds every source's facts, so a page stays a few megabytes. */
const PAGE = 200

/** The sample: finished runs newest first, a page at a time until it is full, then each source's feed language where the source is one of our crawled stories. */
export async function sampleFacts(
  db: SelectDb,
  size: number,
  page: number = PAGE,
): Promise<Omit<FactFixtures, 'version' | 'createdAt' | 'size' | 'dbClass' | 'readOnlyMode'>> {
  const facts: FactFixture[] = []
  let stories = new Set<string>()
  let runsRead = 0
  let olderShape = 0
  let anchor: string | null = null
  for (let offset = 0; facts.length < size; offset += page) {
    const rows = await db.$queryRaw<RunRow[]>`
      SELECT r.id, r.story_id, r.started_at, r.result->'sources' AS sources
      FROM story_research_runs r
      WHERE r.finished_at IS NOT NULL AND r.result IS NOT NULL
      ORDER BY r.started_at DESC, r.id
      LIMIT ${page} OFFSET ${offset}`
    if (offset === 0) anchor = rows[0]?.started_at.toISOString() ?? null
    const picked = pickFacts(rows, size - facts.length, stories)
    facts.push(...picked.facts)
    stories = picked.stories
    runsRead += picked.runsRead
    olderShape += picked.olderShape
    if (rows.length < page) break
  }
  const urls = [...new Set(facts.map(f => f.url))]
  const languages = await db.$queryRaw<{ url: string; language: string }[]>`
    SELECT s.source_url AS url, f.language FROM stories s JOIN feeds f ON f.id = s.feed_id WHERE s.source_url = ANY(${urls})`
  const languageOf = new Map(languages.map(l => [l.url, l.language]))
  return {
    anchor,
    facts: facts.map(f => ({ ...f, language: languageOf.get(f.url) ?? null })),
    runsRead,
    olderShape,
    shortfalls: facts.length < size ? [`${facts.length} of ${size} facts: the database holds no more qualifying facts`] : [],
  }
}

export async function loadFactFixtures(db: ReadOnlyDb, size: number): Promise<FactFixtures> {
  const sample = await db.read(q => sampleFacts(q, size))
  return { version: FACT_FIXTURES_VERSION, createdAt: new Date().toISOString(), size, dbClass: db.dbClass, readOnlyMode: db.mode, ...sample }
}

/** A cached sample (`.cache/fact-fixtures.json`, as parsed) when it is of this version and the size asked for; null to resample. */
export function reusableFixtures(cached: unknown, size: number): FactFixtures | null {
  const fx = cached as Partial<FactFixtures> | null
  return fx?.version === FACT_FIXTURES_VERSION && fx.size === size ? (fx as FactFixtures) : null
}
