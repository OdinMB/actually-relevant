/**
 * What a story research run reads (`.context/story-research.md`): a story of a researchable status
 * with its full-assessment input, the fields it carries today, and its own-corpus material (dedup
 * cluster members, ±14-day neighbours, published stories from the 12 months before it). SELECT
 * only, as tagged `$queryRaw` templates through the client it is given, so the eval can pass its
 * read-only session. Prompt input is built with production's `assessPromptInput`.
 */
import { config } from '../config.js'
import { assessPromptInput, type AssessPromptInput } from './promptInputs.js'
import { SOURCE_TEXT_MAX_CHARS } from './researchFilter.js'

/** The statuses research runs on (the owner's list); any other is refused. */
export const RESEARCHABLE_STATUSES = ['analyzed', 'selected', 'published'] as const

/** The nearest neighbours the dedup prompt confirms, as in production's dedup (design step 1). */
export const NEIGHBOURS_PER_STORY = 6
/** Earlier published stories the earlier-coverage call judges (design step 6). */
export const EARLIER_PER_STORY = 6
/** Cluster members loaded per story; the filter keeps at most two of them. */
export const CLUSTER_MEMBERS_PER_STORY = 6

/** An article we hold: the story's own, a cluster member's, or a neighbour's. */
export interface SourceText {
  storyId: string
  title: string
  url: string
  outlet: string
  /** The feed's language code. */
  language: string
  /** The article's own date as the crawl found it (ISO), or null. */
  datePublished: string | null
  dateCrawled: string
  /** Cut to `SOURCE_TEXT_MAX_CHARS`: only what is sent. */
  content: string
}

export interface NeighbourStory extends SourceText {
  /** Our assessed title and summary, which the dedup prompt compares. */
  assessed: { title: string; summary: string }
  distance: number
}

export interface EarlierStory {
  id: string
  slug: string | null
  title: string
  titleLabel: string | null
  summary: string
  relevanceSummary: string
  /** The stored Why This Matters bullets. */
  whyItMatters: string
  datePublished: string
  distance: number
}

/** What the story page shows today, for the side-by-side read. */
export interface PublishedFields {
  titleLabel: string | null
  title: string
  summary: string
  whyThisMatters: string
  caveats: string
  relevance: number
  relevanceCalculation: string
  quote: string | null
  quoteAttribution: string | null
  marketingBlurb: string | null
}

export interface ResearchStory {
  id: string
  slug: string | null
  /** The story's publication date; for a story not yet published, the time it was loaded. */
  datePublished: string
  original: SourceText
  /** The full assessment's input, content cut to `config.assess.contentMaxLength`. */
  assess: AssessPromptInput
  published: PublishedFields
  clusterMembers: SourceText[]
  neighbours: NeighbourStory[]
  earlier: EarlierStory[]
}

/** The part of a Prisma client (or the eval's read-only session) this module uses. */
export interface ResearchDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>
}

interface ArticleColumns {
  source_title: string
  source_content: string
  source_url: string
  source_date_published: Date | null
  date_crawled: Date
  feed_title: string
  feed_display_title: string | null
  feed_language: string
}

interface StoryRow extends ArticleColumns {
  id: string
  slug: string | null
  date_published: Date
  emotion_tag: string | null
  title_label: string | null
  title: string
  summary: string
  relevance_reasons: string | null
  antifactors: string | null
  relevance: number
  relevance_calculation: string | null
  quote: string | null
  quote_attribution: string | null
  marketing_blurb: string | null
  issue_id: string | null
  issue_factors: string | null
  issue_antifactors: string | null
  issue_ratings: string | null
  feed_issue_factors: string
  feed_issue_antifactors: string
  feed_issue_ratings: string
}

interface MemberRow extends ArticleColumns {
  story_id: string
  id: string
}

interface NeighbourRow extends MemberRow {
  title: string
  summary: string
  distance: number
}

interface EarlierRow {
  story_id: string
  id: string
  slug: string | null
  title: string
  title_label: string | null
  summary: string
  relevance_summary: string | null
  relevance_reasons: string | null
  date_published: Date
  distance: number
}

function sourceText(id: string, r: ArticleColumns): SourceText {
  return {
    storyId: id,
    title: r.source_title,
    url: r.source_url,
    outlet: r.feed_display_title || r.feed_title,
    language: r.feed_language,
    datePublished: r.source_date_published?.toISOString() ?? null,
    dateCrawled: r.date_crawled.toISOString(),
    content: r.source_content.substring(0, SOURCE_TEXT_MAX_CHARS),
  }
}

function story(r: StoryRow, members: MemberRow[], neighbours: NeighbourRow[], earlier: EarlierRow[]): ResearchStory {
  const issue = r.issue_id ? { promptFactors: r.issue_factors ?? '', promptAntifactors: r.issue_antifactors ?? '', promptRatings: r.issue_ratings ?? '' } : null
  const input = assessPromptInput({
    sourceTitle: r.source_title,
    sourceContent: r.source_content,
    sourceUrl: r.source_url,
    emotionTag: r.emotion_tag,
    issue,
    feed: {
      title: r.feed_title,
      issue: { promptFactors: r.feed_issue_factors, promptAntifactors: r.feed_issue_antifactors, promptRatings: r.feed_issue_ratings },
    },
  })
  return {
    id: r.id,
    slug: r.slug,
    datePublished: r.date_published.toISOString(),
    original: sourceText(r.id, r),
    assess: { ...input, content: input.content.substring(0, config.assess.contentMaxLength) },
    published: {
      titleLabel: r.title_label,
      title: r.title,
      summary: r.summary,
      whyThisMatters: r.relevance_reasons ?? '',
      caveats: r.antifactors ?? '',
      relevance: r.relevance,
      relevanceCalculation: r.relevance_calculation ?? '',
      quote: r.quote,
      quoteAttribution: r.quote_attribution,
      marketingBlurb: r.marketing_blurb,
    },
    clusterMembers: members.slice(0, CLUSTER_MEMBERS_PER_STORY).map(m => sourceText(m.id, m)),
    neighbours: neighbours.map(n => ({ ...sourceText(n.id, n), assessed: { title: n.title, summary: n.summary }, distance: Number(n.distance) })),
    earlier: earlier.map(e => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      titleLabel: e.title_label,
      summary: e.summary,
      relevanceSummary: e.relevance_summary ?? '',
      whyItMatters: e.relevance_reasons ?? '',
      datePublished: e.date_published.toISOString(),
      distance: Number(e.distance),
    })),
  }
}

function byStory<R extends { story_id: string }>(rows: R[]): Map<string, R[]> {
  const out = new Map<string, R[]>()
  for (const r of rows) out.set(r.story_id, [...(out.get(r.story_id) ?? []), r])
  return out
}

/**
 * The given stories that research can run on, in the order of `ids`: a researchable status, and a
 * title, summary and rating from their assessment; any other id is left out. A story not yet
 * published takes the load time as its date (in UTC, as the columns hold it), so its earlier
 * coverage is the 12 months of published stories before now.
 */
export async function researchStoriesByIds(db: ResearchDb, ids: string[]): Promise<ResearchStory[]> {
  if (ids.length === 0) return []
  const statuses: string[] = [...RESEARCHABLE_STATUSES]
  const rows = await db.$queryRaw<StoryRow[]>`
    SELECT s.id, s.slug, s.source_title, s.source_content, s.source_url, s.source_date_published, s.date_crawled,
           COALESCE(s.date_published, now() AT TIME ZONE 'UTC') AS date_published,
           s.emotion_tag::text AS emotion_tag, s.title_label, s.title, s.summary, s.relevance_reasons, s.antifactors, s.relevance,
           s.relevance_calculation, s.quote, s.quote_attribution, s.marketing_blurb,
           f.title AS feed_title, f.display_title AS feed_display_title, f.language AS feed_language,
           i.id AS issue_id, i.prompt_factors AS issue_factors, i.prompt_antifactors AS issue_antifactors, i.prompt_ratings AS issue_ratings,
           fi.prompt_factors AS feed_issue_factors, fi.prompt_antifactors AS feed_issue_antifactors, fi.prompt_ratings AS feed_issue_ratings
    FROM stories s
    JOIN feeds f ON f.id = s.feed_id
    JOIN issues fi ON fi.id = f.issue_id
    LEFT JOIN issues i ON i.id = s.issue_id
    WHERE s.id = ANY(${ids}) AND s.status::text = ANY(${statuses})
      AND s.title IS NOT NULL AND s.summary IS NOT NULL AND s.relevance IS NOT NULL`
  const found = rows.map(r => r.id)
  if (found.length === 0) return []

  const members = await db.$queryRaw<MemberRow[]>`
    SELECT src.id AS story_id, m.id, m.source_title, m.source_content, m.source_url, m.source_date_published, m.date_crawled,
           f.title AS feed_title, f.display_title AS feed_display_title, f.language AS feed_language
    FROM stories src
    JOIN stories m ON m.cluster_id = src.cluster_id AND m.id <> src.id
    JOIN feeds f ON f.id = m.feed_id
    WHERE src.id = ANY(${found})
    ORDER BY src.id, m.date_crawled, m.id`

  // Assessed stories crawled within ±14 days, outside the story's cluster; "+ 0" is an order the
  // vector index cannot serve, so distances are exact over the window, as in the eval's fixtures
  const neighbours = await db.$queryRaw<NeighbourRow[]>`
    SELECT src.id AS story_id, c.id, c.title, c.summary, c.source_title, c.source_content, c.source_url, c.source_date_published,
           c.date_crawled, c.feed_title, c.feed_display_title, c.feed_language, c.distance
    FROM stories src JOIN story_embeddings srce ON srce.story_id = src.id
    CROSS JOIN LATERAL (
      SELECT s.id, s.title, s.summary, s.source_title, s.source_content, s.source_url, s.source_date_published, s.date_crawled,
             f.title AS feed_title, f.display_title AS feed_display_title, f.language AS feed_language,
             (se.embedding <=> srce.embedding)::float8 AS distance
      FROM stories s JOIN story_embeddings se ON se.story_id = s.id JOIN feeds f ON f.id = s.feed_id
      WHERE s.id <> src.id AND s.status IN ('analyzed', 'selected', 'published', 'rejected') AND s.title IS NOT NULL AND s.summary IS NOT NULL
        AND s.date_crawled BETWEEN src.date_crawled - interval '14 days' AND src.date_crawled + interval '14 days'
        AND (src.cluster_id IS NULL OR s.cluster_id IS DISTINCT FROM src.cluster_id)
      ORDER BY (se.embedding <=> srce.embedding) + 0
      LIMIT ${NEIGHBOURS_PER_STORY}
    ) c
    WHERE src.id = ANY(${found})
    ORDER BY src.id, c.distance`

  // Published in the 12 months before the story (before now, for one not yet published), outside
  // its cluster; exact, as above
  const earlier = await db.$queryRaw<EarlierRow[]>`
    SELECT src.id AS story_id, c.id, c.slug, c.title, c.title_label, c.summary, c.relevance_summary, c.relevance_reasons, c.date_published, c.distance
    FROM stories src JOIN story_embeddings srce ON srce.story_id = src.id
    CROSS JOIN LATERAL (
      SELECT s.id, s.slug, s.title, s.title_label, s.summary, s.relevance_summary, s.relevance_reasons, s.date_published,
             (se.embedding <=> srce.embedding)::float8 AS distance
      FROM stories s JOIN story_embeddings se ON se.story_id = s.id
      WHERE s.id <> src.id AND s.status = 'published' AND s.title IS NOT NULL AND s.summary IS NOT NULL
        AND s.date_published < COALESCE(src.date_published, now() AT TIME ZONE 'UTC')
        AND s.date_published >= COALESCE(src.date_published, now() AT TIME ZONE 'UTC') - interval '12 months'
        AND (src.cluster_id IS NULL OR s.cluster_id IS DISTINCT FROM src.cluster_id)
      ORDER BY (se.embedding <=> srce.embedding) + 0
      LIMIT ${EARLIER_PER_STORY}
    ) c
    WHERE src.id = ANY(${found})
    ORDER BY src.id, c.distance`

  const m = byStory(members)
  const n = byStory(neighbours)
  const e = byStory(earlier)
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.flatMap(id => {
    const r = byId.get(id)
    return r ? [story(r, m.get(id) ?? [], n.get(id) ?? [], e.get(id) ?? [])] : []
  })
}
