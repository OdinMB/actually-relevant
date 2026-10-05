import { HumanMessage } from '@langchain/core/messages'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { buildBlueskyPickBestPrompt } from '../prompts/index.js'
import type { StoryForBlueskyPick } from '../prompts/index.js'
import { blueskyPickBestSchema } from '../schemas/bluesky.js'

const log = createLogger('social-media')

export type SocialChannelName = 'bluesky' | 'mastodon'

/** Story ids (among `storyIds`) that already have a post on the channel, in any status. */
async function storiesWithPost(channel: SocialChannelName, storyIds: string[]): Promise<Set<string>> {
  const where = { storyId: { in: storyIds } }
  const select = { storyId: true }
  const rows = channel === 'bluesky'
    ? await prisma.blueskyPost.findMany({ where, select })
    : await prisma.mastodonPost.findMany({ where, select })
  return new Set(rows.map((p: { storyId: string }) => p.storyId))
}

/**
 * Find recently published stories that are candidates for social media posting.
 * A story is a candidate when at least one of the given (enabled) channels has
 * no post for it in any status. Any existing post counts — draft and failed
 * included — because generateDraft refuses a story that already has a post.
 *
 * @returns Array of candidate story IDs
 */
export async function findAutoPostCandidates(
  lookbackHours: number,
  channels: SocialChannelName[],
): Promise<string[]> {
  if (channels.length === 0) return []

  const since = new Date()
  since.setHours(since.getHours() - lookbackHours)

  const publishedStories = await prisma.story.findMany({
    where: {
      status: 'published',
      datePublished: { gte: since },
      title: { not: null },
      summary: { not: null },
      slug: { not: null },
    },
    select: { id: true },
  })

  if (publishedStories.length === 0) return []

  const storyIds = publishedStories.map((s) => s.id)

  // Only the enabled channels' tables: a disabled channel never posts, so its
  // missing rows must not keep an already-posted story a candidate.
  const postedSets = await Promise.all(channels.map((c) => storiesWithPost(c, storyIds)))

  return storyIds.filter((id) => postedSets.some((posted) => !posted.has(id)))
}

/**
 * Use LLM to pick the best story from a set for social media posting.
 * This is platform-agnostic — it picks based on content quality and engagement potential.
 *
 * Uses the same pick-best prompt as Bluesky (the criteria are universal).
 */
export async function pickBestStoryForSocial(storyIds: string[]): Promise<{ storyId: string; reasoning: string }> {
  const stories = await prisma.story.findMany({
    where: { id: { in: storyIds } },
    include: { issue: true },
  })

  if (stories.length === 0) throw new Error('No stories found')

  // If only one candidate, just return it
  if (stories.length === 1) {
    return { storyId: stories[0].id, reasoning: 'Only one candidate story.' }
  }

  const storiesForPrompt: StoryForBlueskyPick[] = stories.map((s) => ({
    id: s.id,
    title: s.title || s.sourceTitle,
    titleLabel: s.titleLabel || '',
    summary: s.summary || '',
    relevanceSummary: s.relevanceSummary,
    relevance: s.relevance,
    emotionTag: s.emotionTag,
    issueName: s.issue?.name ?? null,
    datePublished: s.datePublished?.toISOString() ?? null,
  }))

  // Reuse the Bluesky pick-best prompt — the criteria (timeliness, emotional appeal,
  // broad relevance, shareability, uniqueness) are universal across social platforms.
  const prompt = buildBlueskyPickBestPrompt(storiesForPrompt)
  const llm = getLLMByTier(config.socialAutoPost.pickModelTier)
  const structuredLlm = llm.withStructuredOutput(blueskyPickBestSchema)

  await rateLimitDelay()
  log.info({ candidateCount: stories.length }, 'picking best story for social media')
  const result = await structuredLlm.invoke([new HumanMessage(prompt)])

  // Validate the returned storyId exists in candidates
  const valid = stories.find((s) => s.id === result.storyId)
  if (!valid) {
    log.warn({ returnedId: result.storyId }, 'LLM returned invalid storyId, falling back to first candidate')
    return { storyId: stories[0].id, reasoning: 'LLM returned invalid ID; selected first candidate.' }
  }

  log.info({ storyId: result.storyId, reasoning: result.reasoning }, 'best story picked for social media')
  return result
}
