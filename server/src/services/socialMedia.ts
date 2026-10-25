import { HumanMessage } from '@langchain/core/messages'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { buildBlueskyPickBestPrompt } from '../prompts/index.js'
import { blueskyPickBestSchema } from '../schemas/bluesky.js'
import { socialPickStory } from './promptInputs.js'
import { BadRequestError } from '../utils/errors.js'

const log = createLogger('social-media')

export type SocialChannelName = 'bluesky' | 'mastodon'

/** Story ids (among `storyIds`) that already have a post on the channel, in any status. */
async function storiesWithPost(channel: SocialChannelName, storyIds: string[]): Promise<Set<string>> {
  const where = { storyId: { in: storyIds } }
  const select = { storyId: true }
  const rows = channel === 'bluesky' ? await prisma.blueskyPost.findMany({ where, select }) : await prisma.mastodonPost.findMany({ where, select })
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
export async function findAutoPostCandidates(lookbackHours: number, channels: SocialChannelName[]): Promise<string[]> {
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

  const storyIds = publishedStories.map(s => s.id)

  // Only the enabled channels' tables: a disabled channel never posts, so its
  // missing rows must not keep an already-posted story a candidate.
  const postedSets = await Promise.all(channels.map(c => storiesWithPost(c, storyIds)))

  return storyIds.filter(id => postedSets.some(posted => !posted.has(id)))
}

const CHANNEL_LABELS: Record<SocialChannelName, string> = { bluesky: 'Bluesky', mastodon: 'Mastodon' }

/**
 * The one social story picker (both channels' pick-and-draft and the auto-post job): an LLM picks
 * the best story from a set, on content quality and engagement potential, with the pick-best
 * prompt (the criteria are universal across platforms).
 *
 * With `channel` (a manual pick-and-draft), stories that already have a post on that channel, in
 * any status, are skipped first, since generateDraft refuses them; when none is left it throws a
 * BadRequestError. Without it (the auto-post job), the candidates are taken as given:
 * findAutoPostCandidates has filtered them across the enabled channels already.
 */
export async function pickBestStoryForSocial(storyIds: string[], channel?: SocialChannelName): Promise<{ storyId: string; reasoning: string }> {
  const found = await prisma.story.findMany({
    where: { id: { in: storyIds } },
    include: { issue: true },
  })

  if (found.length === 0) throw new BadRequestError('No stories found')

  let stories = found
  if (channel) {
    const posted = await storiesWithPost(
      channel,
      found.map(s => s.id),
    )
    stories = found.filter(s => !posted.has(s.id))
    if (stories.length === 0) throw new BadRequestError(`All selected stories already have a ${CHANNEL_LABELS[channel]} post`)
  }

  // If only one candidate, just return it
  if (stories.length === 1) {
    return { storyId: stories[0]!.id, reasoning: channel ? 'Only one unposted story in the selection.' : 'Only one candidate story.' }
  }

  // Reuse the Bluesky pick-best prompt — the criteria (timeliness, emotional appeal,
  // broad relevance, shareability, uniqueness) are universal across social platforms.
  const prompt = buildBlueskyPickBestPrompt(stories.map(socialPickStory))
  const llm = getLLMByTier(config.socialAutoPost.pickModelTier)
  const structuredLlm = llm.withStructuredOutput(blueskyPickBestSchema)

  await rateLimitDelay()
  log.info({ candidateCount: stories.length }, 'picking best story for social media')
  const result = await structuredLlm.invoke([new HumanMessage(prompt)])

  // Validate the returned storyId exists in candidates
  const valid = stories.find(s => s.id === result.storyId)
  if (!valid) {
    log.warn({ returnedId: result.storyId }, 'LLM returned invalid storyId, falling back to first candidate')
    return { storyId: stories[0]!.id, reasoning: 'LLM returned invalid ID; selected first candidate.' }
  }

  log.info({ storyId: result.storyId, reasoning: result.reasoning }, 'best story picked for social media')
  return result
}
