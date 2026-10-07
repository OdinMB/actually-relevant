/**
 * The standalone episode's entry points (ADR-0015, ADR-0016): create it, and find and choose its
 * stories among all published stories. A person performs its selection stage: saving the stories at
 * `created` moves it to `selected` (interactive); "Suggest stories" asks the selection model for
 * advice and writes nothing. From `selected` on, a standalone episode runs through the same stages,
 * runs and edits as a weekly one; the generate and publish jobs never touch it.
 */
import type { Podcast } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { paginate, type PaginationResult } from '../lib/paginate.js'
import { publishedStoryWhere } from './story.js'
import { chooseStories, loadStoriesByIds, snapshotOf, storyFacts, storySelect, TooFewStoriesError, type EpisodeStory, type PoolStory } from './podcastScript.js'
import { defaultEpisodeTitle, withEpisodeLease } from './podcastPipeline.js'
import { PodcastEditRejectedError, storyCountErrors } from './podcastEditing.js'
import { PodcastRefusedError, wasPublished } from './podcastGuards.js'

/** The finder's filters: when the story was found, its issue (sub-issues included), a text search. */
export interface StandaloneStoryFilters {
  crawledAfter?: string
  crawledBefore?: string
  issueId?: string
  search?: string
}

/** A published story as the finder lists it, ready to become a snapshot. */
export type StoryCandidate = Omit<EpisodeStory, 'ref'> & { relevance: number | null; dateCrawled: Date }

const ORDER = [{ relevance: 'desc' as const }, { dateCrawled: 'desc' as const }]
const candidateSelect = { ...storySelect, dateCrawled: true } as const

const toCandidate = (s: PoolStory & { dateCrawled: Date }): StoryCandidate => ({ ...storyFacts(s), relevance: s.relevance, dateCrawled: s.dateCrawled })

/** A new standalone episode at `created`: no week key, titled with its UTC creation date. */
export async function createStandaloneEpisode(now: Date = new Date()): Promise<Podcast> {
  return prisma.podcast.create({
    data: {
      kind: 'standalone',
      stage: 'created',
      weekKey: null,
      title: defaultEpisodeTitle({ weekKey: null, createdAt: now }),
      createdAt: now,
      dryRun: config.podcast.dryRun,
    },
  })
}

/** One page of the finder's results, with the episode's story limits. */
export type StoryCandidatePage = PaginationResult<StoryCandidate> & { minStories: number; maxStories: number }

/** One page of published stories matching the filters, most relevant first, then newest. */
export async function searchStandaloneStories(
  filters: StandaloneStoryFilters & { page?: number; pageSize?: number },
): Promise<StoryCandidatePage> {
  const page = filters.page || 1
  const pageSize = filters.pageSize || 20
  const where = publishedStoryWhere(filters)
  const result = await paginate({
    findMany: async () => {
      const rows = await prisma.story.findMany({ where, select: candidateSelect, orderBy: ORDER, skip: (page - 1) * pageSize, take: pageSize })
      return rows.map(toCandidate)
    },
    count: () => prisma.story.count({ where }),
    page,
    pageSize,
  })
  return { ...result, minStories: config.podcast.minStories, maxStories: config.podcast.maxStories }
}

/** Refuses anything but a standalone episode whose stories may still be chosen (at `created` or `selected`, never published). */
function assertChoosable(episode: Podcast): void {
  if (episode.stage === 'legacy' || episode.kind !== 'standalone') throw new PodcastRefusedError('only a standalone episode has its stories chosen this way')
  if (wasPublished(episode)) throw new PodcastRefusedError('a published episode cannot be edited')
  if (episode.stage !== 'created' && episode.stage !== 'selected') {
    throw new PodcastRefusedError(`the stories can be chosen at created or selected; this episode is at ${episode.stage}`)
  }
}

/**
 * The selection model's advice for a standalone episode: 4-5 of the most relevant published stories
 * matching the filters (at most `suggestPoolMax` go to the model), in episode order. Writes nothing;
 * the finder puts the result into its draft. 422 when too few stories match.
 */
export async function suggestStandaloneStories(id: string, filters: StandaloneStoryFilters, now: Date = new Date()): Promise<StoryCandidate[]> {
  const episode = await prisma.podcast.findUniqueOrThrow({ where: { id } })
  assertChoosable(episode)
  if (episode.leaseUntil && episode.leaseUntil > now) throw new PodcastRefusedError('the episode is in progress')
  const pool = await prisma.story.findMany({
    where: publishedStoryWhere(filters),
    select: candidateSelect,
    orderBy: ORDER,
    take: config.podcast.suggestPoolMax,
  })
  try {
    return (await chooseStories(pool, 'standalone')).map(toCandidate)
  } catch (err) {
    if (err instanceof TooFewStoriesError) {
      throw new PodcastEditRejectedError([`only ${err.available} stories match the filters; an episode needs ${err.needed}`])
    }
    throw err
  }
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Save a standalone episode's stories, in the given order, refs 1..n, from any published stories.
 * At `created` this is the selection stage, performed by a person: the episode moves to `selected`
 * and becomes interactive, and is not marked "Edited by a person" (its AI line already says a person
 * selected the stories). At `selected` the mode stays, and a changed set or order ticks the flag.
 */
export async function saveStandaloneStories(id: string, storyIds: string[], now: Date = new Date()): Promise<void> {
  const countErrors = storyCountErrors(storyIds)
  if (countErrors.length > 0) throw new PodcastEditRejectedError(countErrors)
  await withEpisodeLease(id, async ({ episode, update }) => {
    assertChoosable(episode)
    const byId = new Map((await loadStoriesByIds(storyIds)).map(s => [s.id, s]))
    const missing = storyIds.filter(storyId => !byId.has(storyId))
    if (missing.length > 0) throw new PodcastEditRejectedError([`not published: ${missing.join(', ')}`])
    const stories = { episodeStories: storyIds.map((storyId, i) => snapshotOf(byId.get(storyId)!, i + 1)), storyIds, storiesSelectedAt: now }
    if (episode.stage === 'created') {
      await update({ ...stories, stage: 'selected', mode: 'interactive' })
      return
    }
    await update({ ...stories, humanEdited: episode.humanEdited || !sameOrder(storyIds, episode.storyIds) })
  }, 'edited')
}
