/**
 * Public story search: Reciprocal Rank Fusion of a semantic (embedding) leg and a text leg over
 * published stories (`.context/embeddings.md`).
 */
import prisma from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { generateSearchEmbedding } from './embedding.js'
import { searchByEmbedding } from '../lib/vectors.js'
import { createLogger } from '../lib/logger.js'
import { storyInIssueSql, storyInIssueWhere } from '../lib/issueFilter.js'
import { PUBLIC_STORY_SELECT } from './storySelect.js'

const log = createLogger('story')

const RRF_FETCH_LIMIT = 50
const RRF_K = 60

/**
 * Reciprocal Rank Fusion: each id scores 1 / (k + rank) in every ranking it appears in (rank from
 * 1), and the ids come back by summed score, highest first. Ties keep first-seen order: the earlier
 * ranking, then the earlier position.
 */
export function fuseRankings(rankings: string[][], k: number = RRF_K): string[] {
  const scores = new Map<string, number>()
  for (const ids of rankings) {
    ids.forEach((id, i) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1))
    })
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

export async function hybridSearch(options: { query: string; issueSlug?: string; page: number; pageSize: number }) {
  const { query, issueSlug, page, pageSize } = options

  // The same issue rule as the text leg, as SQL for the semantic leg
  const issueFilter = issueSlug ? Prisma.sql`AND ${storyInIssueSql(issueSlug)}` : Prisma.empty

  // Run semantic and text searches in parallel
  const [semanticIds, textIds] = await Promise.all([
    // Semantic search leg
    (async () => {
      try {
        const queryEmbedding = await generateSearchEmbedding(query)
        const rows = await searchByEmbedding(queryEmbedding, {
          limit: RRF_FETCH_LIMIT,
          issueFilter,
        })
        return rows.map(r => r.id)
      } catch (err) {
        log.warn({ err }, 'semantic search failed, falling back to text-only')
        return []
      }
    })(),
    // Text search leg
    (async () => {
      const conditions: Prisma.StoryWhereInput[] = []
      conditions.push({
        OR: [{ title: { contains: query, mode: 'insensitive' } }, { summary: { contains: query, mode: 'insensitive' } }],
      })
      if (issueSlug) {
        conditions.push(storyInIssueWhere(issueSlug))
      }
      const rows = await prisma.story.findMany({
        where: { status: 'published', AND: conditions },
        select: { id: true },
        orderBy: [{ datePublished: 'desc' }, { dateCrawled: 'desc' }],
        take: RRF_FETCH_LIMIT,
      })
      return rows.map(r => r.id)
    })(),
  ])

  const rankedIds = fuseRankings([semanticIds, textIds])

  const total = rankedIds.length
  const pageIds = rankedIds.slice((page - 1) * pageSize, page * pageSize)

  if (pageIds.length === 0) {
    return { data: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  // Fetch full story data in ranked order
  const stories = await prisma.story.findMany({
    where: { id: { in: pageIds } },
    select: PUBLIC_STORY_SELECT,
  })

  // Restore RRF rank order
  const storyMap = new Map(stories.map(s => [s.id, s]))
  const ordered = pageIds.map(id => storyMap.get(id)).filter((s): s is NonNullable<typeof s> => s != null)

  return {
    data: ordered,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}
