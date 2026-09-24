/**
 * Every suite's inputs, sampled deterministically from stored data through the
 * read-only session in readOnlyDb.ts. SELECT only.
 *
 * Prompt-input shaping below mirrors the production services (named per
 * block) without calling them, because those functions persist results.
 */
import { Prisma } from '@prisma/client'
import { config } from '../../config.js'
import { pickIntroStyle } from '../../prompts/newsletter-intro.js'
import type { Guidelines, IssueForPrompt } from '../../prompts/shared.js'
import type { StoryForBlueskyPick, StoryForBlueskyPost } from '../../prompts/bluesky.js'
import type { CandidateStory } from '../../prompts/related-stories.js'
import type { StoryForSelect } from '../../prompts/select.js'
import type { StoryForNewsletterSelect } from '../../prompts/newsletter-select.js'
import type { StoryForNewsletterIntro } from '../../prompts/newsletter-intro.js'
import type { StoryForPodcast } from '../../prompts/podcast.js'
import { calcMaxBlurbChars as blueskyMaxChars } from '../../services/bluesky.js'
import { calcMaxBlurbChars as mastodonMaxChars } from '../../services/mastodon.js'
import { mentionsModelName, tallyTerms, withoutModelNames } from './blinding.js'
import { DEFAULT_FLOOR } from './options.js'
import type { Db, ReadOnlyDb } from './readOnlyDb.js'
import { buildSelectionGroups, byEvalHash, stratifiedPick } from './sampling.js'

// ---------------------------------------------------------------------------
// Fixture shapes
// ---------------------------------------------------------------------------

export interface PreassessItem {
  id: string
  title: string
  content: string
  language: string
  han: boolean
  status: string
  stored: { issueSlug: string; rating: number; emotion: string }
}

export interface AssessItem {
  id: string
  title: string
  content: string
  publisher: string
  url: string
  guidelines: Guidelines
  language: string
  han: boolean
  stored: { rating: number }
}

export interface DedupCandidate {
  id: string
  title: string
  summary: string
  distance: number
  sameCluster: boolean
}

export interface DedupSet {
  sourceId: string
  kind: 'cluster-member' | 'hard-negative' | 'random'
  source: { title: string; summary: string }
  candidates: DedupCandidate[]
}

export interface RelatedItem {
  id: string
  source: { titleLabel: string | null; title: string | null }
  candidates: CandidateStory[]
}

export interface SocialPickDay {
  day: string
  candidates: StoryForBlueskyPick[]
  storedPickId: string | null
}

export interface SocialPostItem {
  id: string
  platform: 'bluesky' | 'mastodon'
  story: StoryForBlueskyPost
}

export interface SelectionStory extends StoryForSelect {
  relevance: number | null
}

export interface SelectionGroup {
  id: string
  day: string
  toSelect: number
  stories: SelectionStory[]
  storedPicked: string[]
}

export interface NewsletterItem {
  id: string
  title: string
  longlist: StoryForNewsletterSelect[]
  issueNames: string[]
  storiesPerIssue: number
  storedSelected: string[]
  intro: { stories: StoryForNewsletterIntro[]; issueNames: string[]; style: string }
}

export interface PodcastItem {
  id: string
  source: 'podcast' | 'recent-stories'
  stories: StoryForPodcast[]
}

export interface Fixtures {
  version: 1
  createdAt: string
  /** max(date_crawled) of assessed stories; every "last N days" window counts back from here. */
  anchor: string
  /** Earliest crawl date (`YYYY-MM-DD`) for pre-assess, assess, dedup and social-post samples. */
  floor: string
  dbClass: 'local' | 'remote'
  readOnlyMode: 'session' | 'transaction'
  issues: IssueForPrompt[]
  preassess: PreassessItem[]
  assess: AssessItem[]
  dedup: DedupSet[]
  related: RelatedItem[]
  socialPick: SocialPickDay[]
  socialPickSynthetic: boolean
  socialPost: SocialPostItem[]
  selection: SelectionGroup[]
  newsletters: NewsletterItem[]
  podcast: PodcastItem | null
  shortfalls: string[]
  /** Deviations from the planned sample made for this database, and stories removed for blinding. */
  adaptations: string[]
}

export const TARGETS = {
  preassess: { total: 300, han: 50, published: 60 },
  assess: { total: 50, band: 25, nonEnglish: 10, han: 5 },
  dedup: { clusterMembers: 50, hardNegatives: 50, random: 20, candidates: 6, windowDays: 14 },
  related: { total: 30 },
  socialPick: { days: 10 },
  socialPost: { perPlatform: 10 },
  selection: { groups: 20, minPerDay: 8, poolDays: 90, minAfterBlinding: 4 },
  newsletters: { count: 4 },
  podcastFallbackDays: 7,
  /** Synthetic social-pick windows scan this many days back from the anchor for days with ≥2 candidates. */
  socialPickScanDays: 45,
} as const

/** CJK Unified Ideographs, U+4E00 to U+9FFF (Postgres regex bracket range). */
const HAN_RE = `[${String.fromCharCode(0x4e00)}-${String.fromCharCode(0x9fff)}]`
const DAY_MS = 24 * 60 * 60 * 1000
const ASSESSED = Prisma.sql`s.status IN ('analyzed', 'selected', 'published', 'rejected') AND s.title IS NOT NULL AND s.summary IS NOT NULL`

// ---------------------------------------------------------------------------
// Sampling queries (SELECT only)
// ---------------------------------------------------------------------------

async function loadAnchor(db: Db): Promise<Date> {
  const rows = await db.$queryRaw<{ anchor: Date | null }[]>`
    SELECT max(date_crawled) AS anchor FROM stories WHERE relevance IS NOT NULL`
  return rows[0]?.anchor ?? new Date()
}

async function loadIssues(db: Db): Promise<IssueForPrompt[]> {
  // runBatchClassification sends every issue; ordered here so prompts (and cache keys) are stable.
  return db.issue.findMany({ select: { slug: true, name: true, description: true }, orderBy: { slug: 'asc' } })
}

async function loadPreassess(db: Db, floor: Date, shortfalls: string[]): Promise<PreassessItem[]> {
  const chars = Prisma.raw(String(config.preassess.contentMaxLength))
  const pool = await db.$queryRaw<{ id: string; language: string; status: string; han: boolean }[]>`
    SELECT s.id, f.language, s.status::text AS status,
           (substring(s.source_content, 1, ${chars}) ~ ${HAN_RE}) AS han
    FROM stories s
    JOIN feeds f ON f.id = s.feed_id
    JOIN issues i ON i.id = s.issue_id
    WHERE s.relevance_pre IS NOT NULL AND s.emotion_tag IS NOT NULL AND s.date_crawled >= ${floor}
    ORDER BY md5(s.id || 'gpt6-eval')`
  const t = TARGETS.preassess
  const { picked, shortfalls: missing } = stratifiedPick(pool, {
    total: t.total,
    quotas: [
      { name: 'preassess Han-script', test: p => p.han, min: t.han },
      { name: 'preassess published', test: p => p.status === 'published', min: t.published },
    ],
    spreadBy: p => p.language,
  })
  shortfalls.push(...missing.map(m => `preassess: ${m}`))
  const meta = new Map(picked.map(p => [p.id, p]))
  const rows = await db.story.findMany({
    where: { id: { in: picked.map(p => p.id) } },
    select: { id: true, sourceTitle: true, sourceContent: true, relevancePre: true, emotionTag: true, issue: { select: { slug: true } } },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return picked.flatMap(p => {
    const r = byId.get(p.id)
    if (!r?.issue || r.relevancePre == null || !r.emotionTag) return []
    return [{
      id: r.id,
      title: r.sourceTitle,
      content: r.sourceContent.substring(0, config.preassess.contentMaxLength),
      language: meta.get(r.id)?.language ?? 'unknown',
      han: p.han,
      status: p.status,
      stored: { issueSlug: r.issue.slug, rating: r.relevancePre, emotion: r.emotionTag },
    }]
  })
}

async function loadAssess(db: Db, floor: Date, shortfalls: string[]): Promise<AssessItem[]> {
  const chars = Prisma.raw(String(config.assess.contentMaxLength))
  const pool = await db.$queryRaw<{ id: string; language: string; relevance: number; issue_id: string; han: boolean }[]>`
    SELECT s.id, f.language, s.relevance, COALESCE(s.issue_id, f.issue_id) AS issue_id,
           (substring(s.source_content, 1, ${chars}) ~ ${HAN_RE}) AS han
    FROM stories s
    JOIN feeds f ON f.id = s.feed_id
    WHERE s.relevance IS NOT NULL AND ${ASSESSED} AND s.date_crawled >= ${floor}
    ORDER BY md5(s.id || 'gpt6-eval')`
  const t = TARGETS.assess
  const { picked, shortfalls: missing } = stratifiedPick(pool, {
    total: t.total,
    quotas: [
      { name: 'assess Han-script', test: p => p.han, min: t.han },
      { name: 'assess non-English', test: p => p.language !== 'en', min: t.nonEnglish },
      { name: 'assess rating 4-6', test: p => p.relevance >= 4 && p.relevance <= 6, min: t.band },
    ],
    spreadBy: p => p.issue_id,
  })
  shortfalls.push(...missing.map(m => `assess: ${m}`))
  const guidelineSelect = { promptFactors: true, promptAntifactors: true, promptRatings: true } as const
  const rows = await db.story.findMany({
    where: { id: { in: picked.map(p => p.id) } },
    select: {
      id: true, sourceTitle: true, sourceContent: true, sourceUrl: true, relevance: true,
      issue: { select: guidelineSelect },
      feed: { select: { title: true, language: true, issue: { select: guidelineSelect } } },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  // Mirrors analysis.ts assessStory: guidelines from story.issue ?? feed.issue, publisher = feed.title.
  return picked.flatMap(p => {
    const r = byId.get(p.id)
    if (!r || r.relevance == null) return []
    const issue = r.issue ?? r.feed.issue
    return [{
      id: r.id,
      title: r.sourceTitle,
      content: r.sourceContent.substring(0, config.assess.contentMaxLength),
      publisher: r.feed.title,
      url: r.sourceUrl,
      guidelines: { factors: issue.promptFactors, antifactors: issue.promptAntifactors, ratings: issue.promptRatings },
      language: r.feed.language,
      han: p.han,
      stored: { rating: r.relevance },
    }]
  })
}

async function loadDedup(db: Db, floor: Date, shortfalls: string[], adaptations: string[]): Promise<DedupSet[]> {
  const t = TARGETS.dedup
  const clustered = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT DISTINCT ON (s.cluster_id) s.id, md5(s.id || 'gpt6-eval') AS h
      FROM stories s
      WHERE s.cluster_id IS NOT NULL AND s.embedding IS NOT NULL AND ${ASSESSED} AND s.date_crawled >= ${floor}
      ORDER BY s.cluster_id, md5(s.id || 'gpt6-eval')
    ) one_per_cluster
    ORDER BY h
    LIMIT ${t.clusterMembers}`
  const nearest = await db.$queryRaw<{ id: string; distance: number }[]>`
    SELECT src.id, nn.distance
    FROM (
      SELECT s.id, s.embedding, s.date_crawled FROM stories s
      WHERE s.cluster_id IS NULL AND s.embedding IS NOT NULL AND ${ASSESSED} AND s.date_crawled >= ${floor}
      ORDER BY md5(s.id || 'gpt6-eval')
      LIMIT 400
    ) src
    CROSS JOIN LATERAL (
      SELECT (c.embedding <=> src.embedding)::float8 AS distance FROM stories c
      WHERE c.id <> src.id AND c.embedding IS NOT NULL
        AND c.status IN ('analyzed', 'selected', 'published', 'rejected') AND c.title IS NOT NULL AND c.summary IS NOT NULL
        AND c.date_crawled BETWEEN src.date_crawled - interval '14 days' AND src.date_crawled + interval '14 days'
      ORDER BY c.embedding <=> src.embedding
      LIMIT 1
    ) nn
    ORDER BY md5(src.id || 'gpt6-eval')`
  // Cluster members are there to supply likely duplicates. When the copy has few
  // clusters (dedup started late in its history), the closest unclustered
  // neighbours are the next-best source of them, so they fill the missing slots.
  const extraNearest = Math.max(0, t.clusterMembers - clustered.length)
  if (extraNearest > 0) {
    adaptations.push(`dedup: only ${clustered.length} of ${t.clusterMembers} cluster-member sources exist, so up to ${extraNearest} more closest-neighbour (unclustered) sources fill their slots`)
  }
  const hardNegatives = [...nearest].sort((a, b) => a.distance - b.distance).slice(0, t.hardNegatives + extraNearest)
  const hardIds = new Set(hardNegatives.map(h => h.id))
  const random = nearest.filter(n => !hardIds.has(n.id)).slice(0, t.random)

  const kinds = new Map<string, DedupSet['kind']>([
    ...clustered.map(c => [c.id, 'cluster-member'] as const),
    ...hardNegatives.map(h => [h.id, 'hard-negative'] as const),
    ...random.map(r => [r.id, 'random'] as const),
  ])
  const ids = [...kinds.keys()]
  if (ids.length === 0) {
    shortfalls.push('dedup: no sources with embeddings')
    return []
  }
  // Candidates: assessed stories (auto-rejected duplicates included) within ±14 days of the
  // source, so a later-crawled duplicate of an earlier source still appears.
  const rows = await db.$queryRaw<{ source_id: string; id: string; title: string; summary: string; distance: number; same_cluster: boolean }[]>`
    SELECT src.id AS source_id, c.id, c.title, c.summary, c.distance, c.same_cluster
    FROM stories src
    CROSS JOIN LATERAL (
      SELECT s.id, s.title, s.summary, (s.embedding <=> src.embedding)::float8 AS distance,
             (s.cluster_id IS NOT NULL AND s.cluster_id = src.cluster_id) AS same_cluster
      FROM stories s
      WHERE s.id <> src.id AND s.embedding IS NOT NULL AND ${ASSESSED}
        AND s.date_crawled BETWEEN src.date_crawled - interval '14 days' AND src.date_crawled + interval '14 days'
      ORDER BY s.embedding <=> src.embedding
      LIMIT ${t.candidates}
    ) c
    WHERE src.id = ANY(${ids})
    ORDER BY src.id, c.distance`
  const sources = await db.story.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, summary: true } })
  const sourceById = new Map(sources.map(s => [s.id, s]))
  const sets = ids.flatMap(id => {
    const source = sourceById.get(id)
    const candidates = rows.filter(r => r.source_id === id)
    if (!source?.title || !source.summary || candidates.length === 0) return []
    return [{
      sourceId: id,
      kind: kinds.get(id) ?? 'random',
      source: { title: source.title, summary: source.summary },
      candidates: candidates.map(c => ({ id: c.id, title: c.title, summary: c.summary, distance: Number(c.distance), sameCluster: c.same_cluster })),
    }]
  })
  const want = t.clusterMembers + t.hardNegatives + t.random
  if (sets.length < want) shortfalls.push(`dedup: ${sets.length} of ${want} source sets`)
  return sets
}

async function loadRelated(db: Db, shortfalls: string[]): Promise<RelatedItem[]> {
  const count = config.relatedStories.displayCount * config.relatedStories.candidateMultiplier
  const sources = await db.$queryRaw<{ id: string; title: string | null; title_label: string | null }[]>`
    SELECT s.id, s.title, s.title_label FROM stories s
    WHERE s.status = 'published' AND s.embedding IS NOT NULL
    ORDER BY md5(s.id || 'gpt6-eval')
    LIMIT ${TARGETS.related.total}`
  const ids = sources.map(s => s.id)
  // Mirrors story.ts getRelatedStories: the 12 cosine-nearest published stories.
  const rows = ids.length === 0 ? [] : await db.$queryRaw<{ source_id: string; id: string; title: string | null; title_label: string | null }[]>`
    SELECT src.id AS source_id, c.id, c.title, c.title_label
    FROM stories src
    CROSS JOIN LATERAL (
      SELECT s.id, s.title, s.title_label, s.embedding <=> src.embedding AS distance FROM stories s
      WHERE s.id <> src.id AND s.status = 'published' AND s.embedding IS NOT NULL
      ORDER BY s.embedding <=> src.embedding
      LIMIT ${count}
    ) c
    WHERE src.id = ANY(${ids})
    ORDER BY src.id, c.distance`
  const items = sources.flatMap(s => {
    const candidates = rows.filter(r => r.source_id === s.id).map(r => ({ id: r.id, titleLabel: r.title_label, title: r.title }))
    // Production skips the LLM when there are no more candidates than display slots.
    if (candidates.length <= config.relatedStories.displayCount) return []
    return [{ id: s.id, source: { titleLabel: s.title_label, title: s.title }, candidates }]
  })
  if (items.length < TARGETS.related.total) shortfalls.push(`related: ${items.length} of ${TARGETS.related.total} stories`)
  return items
}

const pickSelect = {
  id: true, title: true, sourceTitle: true, titleLabel: true, summary: true, relevanceSummary: true,
  relevance: true, emotionTag: true, datePublished: true, issue: { select: { name: true } },
} as const

async function loadSocialPick(db: Db, anchor: Date, shortfalls: string[], adaptations: string[]): Promise<{ days: SocialPickDay[]; synthetic: boolean }> {
  const until = new Date(anchor.getTime() + DAY_MS)
  const posts = await db.$queryRaw<{ platform: string; story_id: string; published_at: Date }[]>`
    SELECT 'bluesky' AS platform, story_id, published_at FROM bluesky_posts
    WHERE status = 'published' AND published_at IS NOT NULL AND published_at <= ${until}
    UNION ALL
    SELECT 'mastodon' AS platform, story_id, published_at FROM mastodon_posts
    WHERE status = 'published' AND published_at IS NOT NULL AND published_at <= ${until}`
  const firstPostPerDay = new Map<string, { storyId: string; at: Date }>()
  for (const p of [...posts].sort((a, b) => a.published_at.getTime() - b.published_at.getTime())) {
    const day = p.published_at.toISOString().slice(0, 10)
    if (!firstPostPerDay.has(day)) firstPostPerDay.set(day, { storyId: p.story_id, at: p.published_at })
  }
  const synthetic = firstPostPerDay.size === 0
  // Newest first; the loop below keeps the first TARGETS.socialPick.days windows with ≥2 candidates.
  const windows = synthetic
    ? Array.from({ length: TARGETS.socialPickScanDays }, (_, i) => {
        const at = new Date(anchor.getTime() - i * DAY_MS)
        at.setUTCHours(11, 30, 0, 0) // the social_auto_post cron default
        return { day: at.toISOString().slice(0, 10), storyId: null as string | null, at }
      })
    : [...firstPostPerDay.entries()]
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .map(([day, p]) => ({ day, storyId: p.storyId as string | null, at: p.at }))
  if (synthetic) {
    adaptations.push(`social pick: no stored posts, so synthetic 11:30 UTC windows were scanned up to ${TARGETS.socialPickScanDays} days back from the anchor for days with at least 2 candidates`)
  }

  const days: SocialPickDay[] = []
  for (const w of windows) {
    if (days.length >= TARGETS.socialPick.days) break
    const since = new Date(w.at.getTime() - config.socialAutoPost.lookbackHours * 60 * 60 * 1000)
    // Mirrors socialMedia.ts findAutoPostCandidates at time w.at: a story is a candidate
    // unless it was already posted to both channels before that moment.
    const stories = await db.story.findMany({
      where: { status: 'published', datePublished: { gte: since, lte: w.at }, title: { not: null }, summary: { not: null }, slug: { not: null } },
      select: pickSelect,
      orderBy: { datePublished: 'desc' },
    })
    const postedBefore = (platform: string) =>
      new Set(posts.filter(p => p.platform === platform && p.published_at < w.at).map(p => p.story_id))
    const bs = postedBefore('bluesky')
    const md = postedBefore('mastodon')
    const candidates = stories.filter(s => s.id === w.storyId || !bs.has(s.id) || !md.has(s.id))
    if (candidates.length < 2) continue
    days.push({
      day: w.day,
      storedPickId: w.storyId && candidates.some(c => c.id === w.storyId) ? w.storyId : null,
      // Mirrors socialMedia.ts pickBestStoryForSocial prompt input.
      candidates: candidates.map(s => ({
        id: s.id,
        title: s.title || s.sourceTitle,
        titleLabel: s.titleLabel || '',
        summary: s.summary || '',
        relevanceSummary: s.relevanceSummary,
        relevance: s.relevance,
        emotionTag: s.emotionTag,
        issueName: s.issue?.name ?? null,
        datePublished: s.datePublished?.toISOString() ?? null,
      })),
    })
  }
  if (days.length < TARGETS.socialPick.days) shortfalls.push(`social pick: ${days.length} of ${TARGETS.socialPick.days} days`)
  return { days, synthetic }
}

async function loadSocialPost(db: Db, floor: Date, shortfalls: string[]): Promise<SocialPostItem[]> {
  const n = TARGETS.socialPost.perPlatform
  const ids = await db.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM stories s
    WHERE s.status = 'published' AND s.title IS NOT NULL AND s.summary IS NOT NULL AND s.slug IS NOT NULL
      AND s.date_crawled >= ${floor}
    ORDER BY md5(s.id || 'gpt6-eval')
    LIMIT ${2 * n}`
  const rows = await db.story.findMany({
    where: { id: { in: ids.map(i => i.id) } },
    select: {
      id: true, title: true, titleLabel: true, summary: true, relevanceSummary: true, emotionTag: true,
      sourceUrl: true, slug: true, issue: { select: { name: true } }, feed: { select: { title: true, displayTitle: true } },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  const items = ids.flatMap(({ id }, i) => {
    const s = byId.get(id)
    if (!s?.title || !s.summary || !s.slug) return []
    const platform: SocialPostItem['platform'] = i < n ? 'bluesky' : 'mastodon'
    // Mirrors bluesky.ts / mastodon.ts generateDraft.
    const meta = { issueName: s.issue?.name ?? null, emotionTag: s.emotionTag, publisherName: s.feed.displayTitle || s.feed.title }
    const maxChars = platform === 'bluesky'
      ? blueskyMaxChars(meta)
      : mastodonMaxChars({ ...meta, sourceUrl: s.sourceUrl, storyUrl: `${config.siteUrl}/stories/${s.slug}` })
    return [{
      id: s.id,
      platform,
      story: { id: s.id, title: s.title, titleLabel: s.titleLabel || '', summary: s.summary, relevanceSummary: s.relevanceSummary, maxChars },
    }]
  })
  if (items.length < 2 * n) shortfalls.push(`social post: ${items.length} of ${2 * n} stories`)
  return items
}

async function loadSelection(db: Db, anchor: Date, shortfalls: string[], adaptations: string[]): Promise<SelectionGroup[]> {
  const t = TARGETS.selection
  const since = new Date(anchor.getTime() - t.poolDays * DAY_MS)
  // Eligible like analysis.ts selectStories: relevance ≥ relevanceMin, primary or unclustered.
  const pool = await db.$queryRaw<{ id: string; date_crawled: Date; status: string }[]>`
    SELECT s.id, s.date_crawled, s.status::text AS status
    FROM stories s
    LEFT JOIN story_clusters sc ON sc.id = s.cluster_id
    WHERE s.relevance >= ${config.selection.relevanceMin}
      AND s.status IN ('selected', 'published', 'rejected')
      AND (s.cluster_id IS NULL OR sc.primary_story_id = s.id)
      AND s.title IS NOT NULL
      AND s.date_crawled > ${since} AND s.date_crawled <= ${anchor}`
  // Every group in hash order; the target count is taken after blinding below.
  const drafts = buildSelectionGroups(pool.map(p => ({ id: p.id, dateCrawled: p.date_crawled })), {
    minPerDay: t.minPerDay,
    maxGroupSize: config.selection.maxGroupSize,
    ratio: config.selection.ratio,
    count: Number.MAX_SAFE_INTEGER,
  })
  const statusById = new Map(pool.map(p => [p.id, p.status]))
  const rows = await db.story.findMany({
    where: { id: { in: drafts.flatMap(d => d.storyIds) } },
    select: { id: true, title: true, summary: true, relevanceReasons: true, antifactors: true, relevanceCalculation: true, emotionTag: true, relevance: true },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  const removedFromUsed: unknown[] = []
  let groupsDropped = 0
  const groups = drafts.flatMap(d => {
    const all = d.storyIds.flatMap(id => {
      const r = byId.get(id)
      return r ? [{ ...r, emotionTag: r.emotionTag as string | null }] : []
    })
    // Owner's blinding rule: a story that mentions a model name is removed before any
    // prompt is built, so no arm sees it and no rating item shows it.
    const blinded = withoutModelNames(all)
    if (blinded.kept.length < t.minAfterBlinding) {
      groupsDropped++
      return []
    }
    const keptIds = blinded.kept.map(s => s.id)
    return [{
      id: d.id,
      day: d.day,
      toSelect: Math.ceil(blinded.kept.length * config.selection.ratio),
      stories: blinded.kept,
      storedPicked: keptIds.filter(id => ['selected', 'published'].includes(statusById.get(id) ?? '')),
      removed: blinded.removed,
    }]
  }).slice(0, t.groups).map(({ removed: r, ...g }) => {
    removedFromUsed.push(...r)
    return g
  })
  if (removedFromUsed.length > 0 || groupsDropped > 0) {
    adaptations.push(`selection: ${removedFromUsed.length} stories that mention a model name (${tallyTerms(removedFromUsed)}) were removed from the ${groups.length} groups used, so no arm saw them (owner's blinding rule; pick count recomputed as ceil(n × ${config.selection.ratio})); ${groupsDropped} groups fell below ${t.minAfterBlinding} stories and were dropped`)
  }
  if (groups.length < t.groups) shortfalls.push(`selection: ${groups.length} of ${t.groups} groups`)
  return groups
}

/** Copy of the private ISSUE_ORDER in services/newsletter.ts (intro ordering). */
const ISSUE_ORDER = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']
const issueSortIndex = (slug: string) => (ISSUE_ORDER.indexOf(slug) >= 0 ? ISSUE_ORDER.indexOf(slug) : ISSUE_ORDER.length)

interface IssueRef { name: string; slug: string; parentId: string | null; parent: { name: string; slug: string } | null }
const issueRefSelect = { name: true, slug: true, parentId: true, parent: { select: { name: true, slug: true } } } as const

function topLevelIssue(issue: IssueRef | null | undefined): { name: string; slug: string } {
  if (!issue) return { name: 'General', slug: 'general-news' }
  return issue.parentId && issue.parent ? issue.parent : { name: issue.name, slug: issue.slug }
}

async function loadNewsletters(db: Db, shortfalls: string[], adaptations: string[]): Promise<NewsletterItem[]> {
  const newsletters = await db.newsletter.findMany({
    where: { storyIds: { isEmpty: false }, selectedStoryIds: { isEmpty: false } },
    orderBy: { createdAt: 'desc' },
    take: TARGETS.newsletters.count,
    select: { id: true, title: true, storyIds: true, selectedStoryIds: true },
  })
  const items: NewsletterItem[] = []
  const removed: unknown[] = []
  for (const n of newsletters) {
    const rows = await db.story.findMany({
      where: { id: { in: n.storyIds } },
      select: {
        id: true, title: true, sourceTitle: true, summary: true, marketingBlurb: true, emotionTag: true,
        issue: { select: issueRefSelect }, feed: { select: { issue: { select: issueRefSelect } } },
      },
    })
    // Owner's blinding rule: stories that mention a model name leave the longlist and the intro input.
    const shown = (s: (typeof rows)[number]) => [s.title, s.sourceTitle, s.summary, s.marketingBlurb]
    const stories = rows.filter(s => !mentionsModelName(shown(s)))
    removed.push(...rows.filter(s => mentionsModelName(shown(s))).map(shown))
    const byId = new Map(stories.map(s => [s.id, s]))
    const ordered = n.storyIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []))
    // Mirrors newsletter.ts selectStoriesForNewsletter.
    const longlist = ordered.map(s => ({
      id: s.id,
      title: s.title || s.sourceTitle,
      summary: s.summary,
      issueName: topLevelIssue(s.issue ?? s.feed.issue).name,
      emotionTag: s.emotionTag as string | null,
    }))
    // Mirrors newsletter.ts generateContent intro input (issue order, then title).
    const selected = n.selectedStoryIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []))
    const withIssue = selected.map(s => ({ s, issue: topLevelIssue(s.issue ?? s.feed.issue) }))
    withIssue.sort((a, b) =>
      issueSortIndex(a.issue.slug) - issueSortIndex(b.issue.slug) ||
      (a.s.title || a.s.sourceTitle).localeCompare(b.s.title || b.s.sourceTitle))
    const introIssues = [...new Map(withIssue.map(w => [w.issue.name, w.issue.slug])).entries()]
      .sort(([, a], [, b]) => issueSortIndex(a) - issueSortIndex(b))
      .map(([name]) => name)
    items.push({
      id: n.id,
      title: n.title,
      longlist,
      issueNames: [...new Set(longlist.map(s => s.issueName))].sort(),
      storiesPerIssue: config.newsletter.storiesPerIssue,
      storedSelected: n.selectedStoryIds.filter(id => byId.has(id)),
      intro: {
        stories: withIssue.map(({ s, issue }) => ({
          title: s.title || s.sourceTitle,
          issueName: issue.name,
          blurb: s.marketingBlurb || s.summary || '',
          emotionTag: s.emotionTag || 'calm',
        })),
        issueNames: introIssues,
        style: pickIntroStyle(),
      },
    })
  }
  if (removed.length > 0) adaptations.push(`newsletters: ${removed.length} longlist stories that mention a model name (${tallyTerms(removed)}) were removed before prompting (owner's blinding rule)`)
  if (items.length < TARGETS.newsletters.count) shortfalls.push(`newsletters: ${items.length} of ${TARGETS.newsletters.count}`)
  return items
}

async function loadPodcast(db: Db, anchor: Date, shortfalls: string[], adaptations: string[]): Promise<PodcastItem | null> {
  const podcast = await db.podcast.findFirst({
    where: { storyIds: { isEmpty: false } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, storyIds: true },
  })
  const where: Prisma.StoryWhereInput = podcast
    ? { id: { in: podcast.storyIds } }
    : { status: { in: ['published', 'selected'] }, dateCrawled: { gte: new Date(anchor.getTime() - TARGETS.podcastFallbackDays * DAY_MS), lte: anchor } }
  // Mirrors podcast.ts generateScript.
  const stories = await db.story.findMany({
    where,
    select: {
      title: true, sourceTitle: true, summary: true, relevanceReasons: true, antifactors: true,
      issue: { select: { name: true } }, feed: { select: { title: true, issue: { select: { name: true } } } },
    },
    orderBy: { dateCrawled: 'desc' },
  })
  const shaped = stories.map(s => ({
    category: s.issue?.name || s.feed?.issue?.name || 'General',
    title: s.title || s.sourceTitle,
    summary: s.summary || '',
    publisher: s.feed?.title || 'Unknown',
    relevanceReasons: s.relevanceReasons || '',
    antifactors: s.antifactors || '',
  }))
  // Owner's blinding rule: stories that mention a model name are left out of the script input.
  const { kept, removed } = withoutModelNames(shaped)
  if (removed.length > 0) adaptations.push(`podcast: ${removed.length} of ${shaped.length} stories that mention a model name (${tallyTerms(removed)}) were removed before prompting (owner's blinding rule)`)
  if (kept.length === 0) {
    shortfalls.push('podcast: no stories')
    return null
  }
  if (!podcast) shortfalls.push('podcast: no stored podcast; used the 7 days of published/selected stories before the anchor')
  return {
    id: podcast?.id ?? 'recent-stories',
    source: podcast ? 'podcast' : 'recent-stories',
    stories: kept,
  }
}

/**
 * Sample every suite's inputs in one read-only pass. `floor` (`YYYY-MM-DD`,
 * UTC) is the earliest crawl date for the stored-data suites.
 */
export async function loadFixtures(db: ReadOnlyDb, floorDay: string): Promise<Fixtures> {
  const floor = new Date(`${floorDay}T00:00:00Z`)
  return db.read(async q => {
    const shortfalls: string[] = []
    const adaptations: string[] = []
    const anchor = await loadAnchor(q)
    if (floorDay !== DEFAULT_FLOOR) {
      adaptations.push(`crawl floor moved from ${DEFAULT_FLOOR} to ${floorDay} for pre-assess, assess, dedup and social-post samples (newest assessed crawl in this database: ${anchor.toISOString().slice(0, 10)})`)
    }
    const issues = await loadIssues(q)
    const preassess = await loadPreassess(q, floor, shortfalls)
    const assess = await loadAssess(q, floor, shortfalls)
    const dedup = await loadDedup(q, floor, shortfalls, adaptations)
    const related = byEvalHash(await loadRelated(q, shortfalls), r => r.id)
    const social = await loadSocialPick(q, anchor, shortfalls, adaptations)
    const socialPost = await loadSocialPost(q, floor, shortfalls)
    const selection = await loadSelection(q, anchor, shortfalls, adaptations)
    const newsletters = await loadNewsletters(q, shortfalls, adaptations)
    const podcast = await loadPodcast(q, anchor, shortfalls, adaptations)
    return {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      anchor: anchor.toISOString(),
      floor: floorDay,
      dbClass: db.dbClass,
      readOnlyMode: db.mode,
      issues,
      preassess,
      assess,
      dedup,
      related,
      socialPick: social.days,
      socialPickSynthetic: social.synthetic,
      socialPost,
      selection,
      newsletters,
      podcast,
      shortfalls,
      adaptations,
    }
  })
}
