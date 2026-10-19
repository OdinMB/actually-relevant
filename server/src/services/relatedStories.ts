/**
 * Related stories on the public story page: the cosine-nearest published stories, re-ranked by a
 * small-tier model and cached per slug (`.context/embeddings.md`). The model call on the public
 * request path is deliberate (ADR-0043).
 */
import prisma from '../lib/prisma.js'
import { HumanMessage } from '@langchain/core/messages'
import { createLogger } from '../lib/logger.js'
import { config } from '../config.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { buildRelatedStoriesPrompt } from '../prompts/related-stories.js'
import { relatedStoriesResultSchema } from '../schemas/llm.js'
import { TTLCache, cached } from '../lib/cache.js'
import { PUBLIC_STORY_SELECT } from './storySelect.js'

const log = createLogger('story')

/** A source story's LLM-ranked related story ids (`displayCount` of them, best first). */
interface RelatedEntry {
  sourceId: string
  ids: string[]
}

// Per source slug. Every read re-checks that the source and each related story are still published,
// so the cache never serves an unpublished story; unpublishing also drops the story's own entry.
const MAX_RELATED_CACHE_SIZE = 500
const relatedCache = new TTLCache<RelatedEntry | null>(
  config.relatedStories.cacheHours * 60 * 60 * 1000,
  { maxEntries: MAX_RELATED_CACHE_SIZE },
)

/** Drop the cached related lists of these stories, which left `published` or were deleted. */
export function forgetRelatedStories(storyIds: string[]): void {
  if (storyIds.length === 0) return
  const gone = new Set(storyIds)
  relatedCache.invalidateWhere(entry => entry !== null && gone.has(entry.sourceId))
}

/**
 * Related stories for a published story: the cosine-nearest published stories, re-ranked by a
 * small-tier model and cached per slug (`.context/embeddings.md`). Concurrent misses for a slug share
 * one computation (one LLM call); only the published ones of the cached ids are returned.
 */
export async function getRelatedStories(slug: string, limit: number = config.relatedStories.displayCount) {
  const entry = await cached(relatedCache, slug, () => rankRelatedStories(slug), e => e !== null && e.ids.length > 0)
  if (!entry || entry.ids.length === 0) return []

  // One query checks the source is still published and fetches the published related stories
  const rows = await prisma.story.findMany({
    where: { id: { in: [entry.sourceId, ...entry.ids] }, status: 'published' },
    select: PUBLIC_STORY_SELECT,
  })
  const storyMap = new Map(rows.map((s) => [s.id, s]))
  if (!storyMap.has(entry.sourceId)) {
    relatedCache.invalidate(slug)
    return []
  }
  return entry.ids
    .map((id) => storyMap.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .slice(0, limit)
}

/** Steps 2-5 of getRelatedStories: null when no published story with an embedding has this slug. */
async function rankRelatedStories(slug: string): Promise<RelatedEntry | null> {
  const displayCount = config.relatedStories.displayCount

  // 2. Find the source story and verify it has an embedding
  const rows = await prisma.$queryRaw<{ id: string; title: string | null; title_label: string | null }[]>`
    SELECT id, title, title_label FROM stories
    WHERE slug = ${slug} AND status = 'published' AND embedding IS NOT NULL
    LIMIT 1
  `
  if (rows.length === 0) return null

  const source = rows[0]
  const candidateCount = displayCount * config.relatedStories.candidateMultiplier

  // 3. Get a larger candidate pool via cosine distance
  const candidates = await prisma.$queryRaw<{ id: string; title: string | null; title_label: string | null }[]>`
    SELECT s.id, s.title, s.title_label
    FROM stories s
    WHERE s.id != ${source.id}
      AND s.status = 'published'
      AND s.embedding IS NOT NULL
    ORDER BY s.embedding <=> (SELECT embedding FROM stories WHERE id = ${source.id})
    LIMIT ${candidateCount}
  `
  if (candidates.length === 0) return { sourceId: source.id, ids: [] }

  // 4. If we have fewer candidates than needed, skip LLM and return all
  let selectedIds: string[]
  if (candidates.length <= displayCount) {
    selectedIds = candidates.map((c) => c.id)
  } else {
    // 5. LLM re-ranking
    try {
      const prompt = buildRelatedStoriesPrompt(
        { titleLabel: source.title_label, title: source.title },
        candidates.map((c) => ({ id: c.id, titleLabel: c.title_label, title: c.title })),
        displayCount,
      )

      await rateLimitDelay()
      const llm = getLLMByTier(config.relatedStories.modelTier)
      const structuredLlm = llm.withStructuredOutput(relatedStoriesResultSchema)
      const response = await structuredLlm.invoke([new HumanMessage(prompt)])

      // Validate returned IDs against candidate pool
      const candidateIdSet = new Set(candidates.map((c) => c.id))
      const validIds = response.selectedIds.filter((id) => candidateIdSet.has(id))

      if (validIds.length > 0) {
        selectedIds = validIds.slice(0, displayCount)
        log.info({ slug, candidateCount: candidates.length, selectedCount: selectedIds.length }, 'LLM re-ranked related stories')
      } else {
        // LLM returned no valid IDs — fall back to cosine order
        log.warn({ slug }, 'LLM returned no valid IDs for related stories, falling back to cosine')
        selectedIds = candidates.slice(0, displayCount).map((c) => c.id)
      }
    } catch (err) {
      // LLM failed — fall back to cosine order
      log.warn({ err, slug }, 'LLM re-ranking failed for related stories, falling back to cosine')
      selectedIds = candidates.slice(0, displayCount).map((c) => c.id)
    }
  }

  return { sourceId: source.id, ids: selectedIds }
}
