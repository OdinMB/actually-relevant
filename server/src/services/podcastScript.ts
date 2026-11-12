/**
 * An episode's stories and words: the week's story pool of its show and the episode's frozen story
 * snapshots, the two LLM calls (story selection from a pool, dialogue), and the show notes.
 */
import { HumanMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import { EmotionTag, StoryStatus, type PodcastEdition, type PodcastKind, type Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { podcastEpisodeAiLine } from '../lib/aiLabelCopy.js'
import { buildPodcastPrompt, buildPodcastSelectPrompt, type StoryForPodcast } from '../prompts/index.js'
import type { PodcastPromptKind } from '../prompts/podcast.js'
import { podcastDialogueSchemaFor, podcastSelectResultSchema, type PodcastDialogue } from '../schemas/llm.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { dialogueCharBudget, validateDialogue } from './podcastDialogue.js'
import { podcastEditionInfo } from './podcastEdition.js'
import { PodcastBlockedError } from './podcastGuards.js'
import { podcastHeading, podcastScriptStory, podcastSelectStory } from './promptInputs.js'
import { storedResearchText } from './researchedStory.js'

const log = createLogger('podcast-script')
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A story as the episode froze it; validation, show notes and the feed read this, never `storyIds`.
 * A type alias rather than an interface, so it is assignable to Prisma's JSON input.
 */
export type EpisodeStory = {
  ref: number
  id: string
  title: string
  publisher: string
  sourceUrl: string
  slug: string | null
  issue: string
}

/** The episode's frozen stories; an episode past `created` always has them. */
export function episodeSnapshots(episode: { id: string; episodeStories: unknown }): EpisodeStory[] {
  if (!Array.isArray(episode.episodeStories)) throw new Error(`podcast ${episode.id} has no stories selected`)
  return episode.episodeStories as EpisodeStory[]
}

export interface SelectedStory {
  snapshot: EpisodeStory
  prompt: StoryForPodcast
}

export interface EpisodeScript {
  dialogue: PodcastDialogue
  modelId: string
}

type Tier = 'small' | 'medium' | 'large'

/** One structured call with usage logged; `null` when the answer did not parse. */
async function invokeStructured<S extends z.ZodTypeAny>(schema: S, tier: Tier, prompt: string, call: string): Promise<z.infer<S> | null> {
  await rateLimitDelay()
  const llm = getLLMByTier(tier).withStructuredOutput(schema, { includeRaw: true })
  // Retried by the OpenAI SDK (maxRetries in createChatModel), not by withRetry
  const res = await llm.invoke([new HumanMessage(prompt)])
  const usage = (res.raw as { usage_metadata?: unknown }).usage_metadata
  log.info({ call, model: config.llm.models[tier].name, usage, parsed: res.parsed != null }, 'podcast LLM call')
  return (res.parsed ?? null) as z.infer<S> | null
}

/** The fields every story loader of the podcast reads (pool, snapshots, prompt material). */
export const storySelect = {
  id: true,
  title: true,
  sourceTitle: true,
  sourceUrl: true,
  slug: true,
  summary: true,
  relevanceSummary: true,
  relevanceReasons: true,
  antifactors: true,
  relevance: true,
  emotionTag: true,
  research: true,
  issue: { select: { name: true, parent: { select: { name: true } } } },
  feed: { select: { title: true, displayTitle: true, issue: { select: { name: true, parent: { select: { name: true } } } } } },
} as const

/** A story as the podcast loads it (`storySelect`), before it becomes a snapshot. */
export type PoolStory = Awaited<ReturnType<typeof loadPool>>[number]

/**
 * The newsletter's pool: stories published from the week's crawl before `anchor`. The anchor is when
 * the episode's stories were selected (`storiesSelectedAt`), so the model and the story picker read
 * the same list whenever either reads it. Actually Uplifting's pool is the same week's stories tagged
 * uplifting, never an earlier week's.
 */
function poolWhere(anchor: Date, edition: PodcastEdition): Prisma.StoryWhereInput {
  return {
    status: StoryStatus.published,
    dateCrawled: { gte: new Date(anchor.getTime() - config.content.storyAssignmentDays * DAY_MS), lte: anchor },
    ...(edition === 'uplifting' ? { emotionTag: EmotionTag.uplifting } : {}),
  }
}

/** The show's pool before `anchor`, most relevant first. */
function loadPool(anchor: Date, edition: PodcastEdition) {
  return prisma.story.findMany({
    where: poolWhere(anchor, edition),
    select: storySelect,
    orderBy: [{ relevance: 'desc' }, { dateCrawled: 'desc' }],
  })
}

/** How many stories the show's pool before `anchor` holds (a short week is known before any row is made). */
export function episodePoolSize(anchor: Date, edition: PodcastEdition): Promise<number> {
  return prisma.story.count({ where: poolWhere(anchor, edition) })
}

/** Which prompt wording an episode takes: the Actually Uplifting show's own, otherwise its kind's. */
export function promptWordingKind(kind: PodcastKind, edition: PodcastEdition): PodcastPromptKind {
  return edition === 'uplifting' ? 'uplifting' : kind
}

/** A story's facts as the episode shows them: title, publisher, links and top-level issue. */
export const storyFacts = (s: PoolStory): Omit<EpisodeStory, 'ref'> => {
  const heading = podcastHeading(s)
  return { id: s.id, title: heading.title, publisher: heading.publisher, sourceUrl: s.sourceUrl, slug: s.slug, issue: heading.issue }
}

/** The frozen snapshot of a story at position `ref` in the episode. */
export const snapshotOf = (s: PoolStory, ref: number): EpisodeStory => ({ ref, ...storyFacts(s) })

/** The dialogue prompt's material of a story: a researched one's story text in place of its summary. */
const scriptMaterial = (s: PoolStory, snapshot: EpisodeStory) => podcastScriptStory({ ...s, storyText: storedResearchText(s.research) }, snapshot)

function toSelected(s: PoolStory, ref: number): SelectedStory {
  const snapshot = snapshotOf(s, ref)
  return { snapshot, prompt: scriptMaterial(s, snapshot) }
}

/** A story of the week's pool as the story picker lists it, ready to become a snapshot. */
export type PoolEntry = Omit<EpisodeStory, 'ref'> & { relevance: number | null }

/** The pool the selection call chose from, for the story picker (same query, same order). */
export async function loadEpisodePool(anchor: Date, edition: PodcastEdition): Promise<PoolEntry[]> {
  const pool = await loadPool(anchor, edition)
  return pool.map(s => ({ ...storyFacts(s), relevance: s.relevance }))
}

/**
 * The prompt material of the episode's frozen stories, in snapshot order. A story that is no longer
 * published fails the script stage (kept on the row), so a person changes the selection.
 */
export async function loadEpisodeStories(snapshots: EpisodeStory[]): Promise<SelectedStory[]> {
  const byId = new Map((await loadStoriesByIds(snapshots.map(s => s.id))).map(r => [r.id, r]))
  return snapshots.map(snapshot => {
    const story = byId.get(snapshot.id)
    if (!story) throw new Error(`story "${snapshot.title}" is no longer published; change the selection`)
    return { snapshot, prompt: scriptMaterial(story, snapshot) }
  })
}

/** The published stories among `ids`, of any date, in no particular order (a missing id is not published). */
export function loadStoriesByIds(ids: string[]): Promise<PoolStory[]> {
  return prisma.story.findMany({ where: { id: { in: ids }, status: StoryStatus.published }, select: storySelect })
}

/** The pool holds fewer stories than an episode needs; the model is not asked. */
export class TooFewStoriesError extends Error {
  constructor(
    readonly available: number,
    readonly needed: number,
  ) {
    super(`only ${available} stories to choose from; an episode needs ${needed}`)
    this.name = 'TooFewStoriesError'
  }
}

/**
 * The model's 4-5 stories from `pool`, in episode order: unknown and duplicate ids dropped, capped at
 * the maximum. `TooFewStoriesError` before any call when the pool is under the minimum; an error
 * when the model's valid answer is.
 */
export async function chooseStories<S extends PoolStory>(pool: S[], kind: PodcastPromptKind): Promise<S[]> {
  const { minStories, maxStories, selectModelTier } = config.podcast
  if (pool.length < minStories) throw new TooFewStoriesError(pool.length, minStories)
  const prompt = buildPodcastSelectPrompt(
    pool.map(s => podcastSelectStory(s, podcastHeading(s))),
    minStories,
    maxStories,
    kind,
  )
  const result = await invokeStructured(podcastSelectResultSchema, selectModelTier, prompt, 'podcast-select')
  if (!result) throw new Error('podcast selection: the model returned no parsable output')

  const byId = new Map(pool.map(s => [s.id, s]))
  const ids = [...new Set(result.selectedIds)].filter(id => byId.has(id)).slice(0, maxStories)
  if (ids.length < minStories) {
    throw new Error(`podcast selection returned ${ids.length} valid stories; an episode needs ${minStories}`)
  }
  return ids.map(id => byId.get(id)!)
}

/** The week's 4-5 stories for the show's audio, in episode order, from its pool before `anchor`. Fails closed under the minimum. */
export async function selectEpisodeStories(anchor: Date, edition: PodcastEdition): Promise<SelectedStory[]> {
  try {
    const chosen = await chooseStories(await loadPool(anchor, edition), promptWordingKind('weekly', edition))
    return chosen.map((s, i) => toSelected(s, i + 1))
  } catch (err) {
    if (err instanceof TooFewStoriesError) {
      const which = edition === 'uplifting' ? 'published uplifting stories' : 'published stories'
      throw new Error(`only ${err.available} ${which} this week; an episode needs ${err.needed}`, { cause: err })
    }
    throw err
  }
}

/**
 * The dialogue for the selected stories of an episode of `kind` on the show `edition`, which picks
 * the prompt's wording; the length budget, schema and validation follow the kind. An invalid or
 * unparsable answer gets one regeneration with the problems listed; a second failure blocks the
 * episode (never truncated or patched).
 */
export async function writeEpisodeScript(stories: SelectedStory[], kind: PodcastKind, edition: PodcastEdition): Promise<EpisodeScript> {
  const tier = config.podcast.scriptModelTier
  const refs = stories.map(s => ({ ref: s.snapshot.ref, title: s.snapshot.title, publisher: s.snapshot.publisher }))
  let problems: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildPodcastPrompt(
      stories.map(s => s.prompt),
      dialogueCharBudget(kind),
      promptWordingKind(kind, edition),
      problems,
    )
    const dialogue = await invokeStructured(podcastDialogueSchemaFor(kind), tier, prompt, 'podcast-script')
    if (!dialogue) {
      problems = ['the previous answer did not match the output schema']
      continue
    }
    const validation = validateDialogue(dialogue, refs, { kind })
    if (validation.valid) return { dialogue, modelId: config.llm.models[tier].name }
    log.warn({ attempt, errors: validation.errors }, 'podcast dialogue invalid')
    problems = validation.errors
  }
  throw new PodcastBlockedError(`the dialogue is still invalid after one regeneration: ${problems.join('; ')}`)
}

/**
 * Plain-text show notes: the AI line first (the edited wording when a person changed the stories or
 * the script), the summary, then each story with our analysis and its source, the show's pointer to
 * more of its news (Actually Uplifting's), and last the donation ask.
 */
export function buildShowNotes(summary: string, stories: EpisodeStory[], humanEdited: boolean, kind: PodcastKind, edition: PodcastEdition): string {
  const items = stories.map(s =>
    [`${s.ref}. ${s.title} (${s.publisher})`, ...(s.slug ? [`   Our AI analysis: ${config.siteUrl}/stories/${s.slug}`] : []), `   Source: ${s.sourceUrl}`].join(
      '\n',
    ),
  )
  const { moreLink } = podcastEditionInfo(edition)
  return [
    podcastEpisodeAiLine(humanEdited, kind),
    '',
    summary.trim(),
    '',
    'Stories in this episode:',
    ...items,
    '',
    ...(moreLink ? [`${moreLink.text}: ${moreLink.url}`] : []),
    `${config.donation.pitch} ${config.donation.cta}: ${config.links.kofi}`,
  ].join('\n')
}
