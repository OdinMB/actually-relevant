/**
 * Which stories an Actually Uplifting issue carries (ADR-0052, `.context/newsletter-podcast.md`,
 * "Editions"). The lifecycle's assign and select moves call these for an issue of that edition, in
 * place of `newsletter.ts`'s `recentStoryIds` and `pickShortlist`; every rule of the moves holds as
 * for the full edition.
 *
 * - Longlist: the published stories tagged `uplifting` crawled in the last `storyAssignmentDays`
 *   days that no other built Actually Uplifting issue carries on its shortlist, most relevant first,
 *   then newest. Only this window: an issue never reaches back into earlier weeks.
 * - Shortlist: the whole longlist while it holds at most `config.newsletter.uplifting.maxStories`
 *   stories, with no model call; with more, the newsletter selection model picks that many. The
 *   select move then swaps a pick for newer coverage inside the longlist, as for the full edition.
 */
import { HumanMessage } from '@langchain/core/messages'
import { EmotionTag, StoryStatus, type Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { BadRequestError } from '../utils/errors.js'
import { buildUpliftingSelectPrompt } from '../prompts/index.js'
import { newsletterSelectResultSchema } from '../schemas/llm.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import type { ShortlistPicks } from './newsletter.js'
import { upliftingSelectInput } from './promptInputs.js'

const log = createLogger('uplifting-issue')

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The week's uplifting stories no other built Actually Uplifting issue carries, most relevant first,
 * then newest; empty when there are none. `issueId` is the issue being built, whose own shortlist
 * does not count. The weekly job's "no issue this week" check reads the same list.
 */
export async function upliftingCandidateIds(client: Prisma.TransactionClient = prisma, issueId?: string): Promise<string[]> {
  const others = await client.newsletter.findMany({
    where: { edition: 'uplifting', html: { not: '' }, ...(issueId ? { id: { not: issueId } } : {}) },
    select: { selectedStoryIds: true },
  })
  const carried = [...new Set(others.flatMap(issue => issue.selectedStoryIds))]
  const stories = await client.story.findMany({
    where: {
      status: StoryStatus.published,
      emotionTag: EmotionTag.uplifting,
      dateCrawled: { gte: new Date(Date.now() - config.content.storyAssignmentDays * DAY_MS) },
      ...(carried.length > 0 ? { id: { notIn: carried } } : {}),
    },
    orderBy: [{ relevance: { sort: 'desc', nulls: 'last' } }, { dateCrawled: 'desc' }],
    select: { id: true },
  })
  return stories.map(story => story.id)
}

/** The issue's longlist (`upliftingCandidateIds`); refused when the week has no uplifting story left to carry. */
export async function upliftingLonglist(client: Prisma.TransactionClient, issueId: string): Promise<string[]> {
  const storyIds = await upliftingCandidateIds(client, issueId)
  if (storyIds.length === 0) throw new BadRequestError('No uplifting stories to assign this week')
  return storyIds
}

/**
 * The shortlist of an issue with a (non-empty) longlist: all of it up to `maxStories`, else the
 * model's pick of `maxStories`, only longlist ids and each once. With each longlist story's section,
 * for the newer-coverage swap.
 */
export async function pickUpliftingShortlist(newsletter: { id: string; storyIds: string[] }): Promise<ShortlistPicks> {
  const rows = await prisma.story.findMany({
    where: { id: { in: newsletter.storyIds } },
    select: {
      id: true,
      title: true,
      sourceTitle: true,
      summary: true,
      emotionTag: true,
      issue: { select: { id: true, name: true, parentId: true, parent: { select: { name: true } } } },
      feed: { select: { issue: { select: { name: true, parentId: true, parent: { select: { name: true } } } } } },
    },
  })
  const stories = upliftingSelectInput(rows, newsletter.storyIds)
  const sections = new Map(stories.map(story => [story.id, story.issueName]))
  const maxStories = config.newsletter.uplifting.maxStories
  if (stories.length <= maxStories) return { storyIds: stories.map(story => story.id), sections }

  log.info({ newsletterId: newsletter.id, storyCount: stories.length, maxStories }, 'selecting stories for the Actually Uplifting issue')
  await rateLimitDelay()
  const llm = getLLMByTier(config.newsletter.selectModelTier).withStructuredOutput(newsletterSelectResultSchema)
  // Retried by the OpenAI SDK (maxRetries in createChatModel), not by withRetry
  const response = await llm.invoke([new HumanMessage(buildUpliftingSelectPrompt(stories, maxStories))])

  const onLonglist = new Set(sections.keys())
  const storyIds = [...new Set(response.selectedIds.filter(id => onLonglist.has(id)))].slice(0, maxStories)
  log.info({ newsletterId: newsletter.id, selectedCount: storyIds.length }, 'Actually Uplifting story selection complete')
  return { storyIds, sections }
}
