/**
 * The weekly episode's stories and words: the week's story pool and the episode's frozen story
 * snapshots, the two LLM calls (story selection, dialogue), and the show notes.
 */
import { HumanMessage } from '@langchain/core/messages'
import type { z } from 'zod'
import { StoryStatus } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { withRetry } from '../lib/retry.js'
import { podcastEpisodeAiLine } from '../lib/aiLabelCopy.js'
import { buildPodcastPrompt, buildPodcastSelectPrompt, type StoryForPodcast } from '../prompts/index.js'
import { podcastDialogueSchema, podcastSelectResultSchema, type PodcastDialogue } from '../schemas/llm.js'
import { getLLMByTier, rateLimitDelay } from './llm.js'
import { dialogueCharBudget, validateDialogue } from './podcastDialogue.js'
import { PodcastBlockedError } from './podcastGuards.js'

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
  const res = await withRetry(() => llm.invoke([new HumanMessage(prompt)]), { retries: 3 })
  const usage = (res.raw as { usage_metadata?: unknown }).usage_metadata
  log.info({ call, model: config.llm.models[tier].name, usage, parsed: res.parsed != null }, 'podcast LLM call')
  return (res.parsed ?? null) as z.infer<S> | null
}

const storySelect = {
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
  issue: { select: { name: true, parent: { select: { name: true } } } },
  feed: { select: { title: true, displayTitle: true, issue: { select: { name: true, parent: { select: { name: true } } } } } },
} as const

type PoolStory = Awaited<ReturnType<typeof loadPool>>[number]

/**
 * The newsletter's pool: stories published from the week's crawl before `anchor`, most relevant
 * first. The anchor is when the episode's stories were selected (`storiesSelectedAt`), so the
 * model and the story picker read the same list whenever either reads it.
 */
function loadPool(anchor: Date) {
  return prisma.story.findMany({
    where: {
      status: StoryStatus.published,
      dateCrawled: { gte: new Date(anchor.getTime() - config.content.storyAssignmentDays * DAY_MS), lte: anchor },
    },
    select: storySelect,
    orderBy: [{ relevance: 'desc' }, { dateCrawled: 'desc' }],
  })
}

function topIssueName(s: PoolStory): string {
  const issue = s.issue ?? s.feed?.issue
  return issue?.parent?.name ?? issue?.name ?? 'General'
}

const storyFacts = (s: PoolStory): Omit<EpisodeStory, 'ref'> => ({
  id: s.id,
  title: s.title || s.sourceTitle,
  publisher: s.feed?.displayTitle || s.feed?.title || 'Unknown',
  sourceUrl: s.sourceUrl,
  slug: s.slug,
  issue: topIssueName(s),
})

const snapshotOf = (s: PoolStory, ref: number): EpisodeStory => ({ ref, ...storyFacts(s) })

/** The prompt material for a story, under the episode's frozen snapshot (its ref, title and publisher). */
function promptFor(s: PoolStory, snapshot: EpisodeStory): StoryForPodcast {
  return {
    ref: snapshot.ref,
    issue: snapshot.issue,
    title: snapshot.title,
    publisher: snapshot.publisher,
    summary: s.summary || '',
    whyItMatters: s.relevanceSummary || s.relevanceReasons || '',
    limitingFactors: s.antifactors || '',
  }
}

function toSelected(s: PoolStory, ref: number): SelectedStory {
  const snapshot = snapshotOf(s, ref)
  return { snapshot, prompt: promptFor(s, snapshot) }
}

/** A story of the week's pool as the story picker lists it, ready to become a snapshot. */
export type PoolEntry = Omit<EpisodeStory, 'ref'> & { relevance: number | null }

/** The pool the selection call chose from, for the story picker (same query, same order). */
export async function loadEpisodePool(anchor: Date): Promise<PoolEntry[]> {
  const pool = await loadPool(anchor)
  return pool.map(s => ({ ...storyFacts(s), relevance: s.relevance }))
}

/**
 * The prompt material of the episode's frozen stories, in snapshot order. A story that is no longer
 * published fails the script stage (kept on the row), so a person changes the selection.
 */
export async function loadEpisodeStories(snapshots: EpisodeStory[]): Promise<SelectedStory[]> {
  const rows = await prisma.story.findMany({
    where: { id: { in: snapshots.map(s => s.id) }, status: StoryStatus.published },
    select: storySelect,
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return snapshots.map(snapshot => {
    const story = byId.get(snapshot.id)
    if (!story) throw new Error(`story "${snapshot.title}" is no longer published; change the selection`)
    return { snapshot, prompt: promptFor(story, snapshot) }
  })
}

/** The week's 4-5 stories for audio, in episode order, from the pool before `anchor`. Fails closed under the minimum. */
export async function selectEpisodeStories(anchor: Date): Promise<SelectedStory[]> {
  const { minStories, maxStories, selectModelTier } = config.podcast
  const pool = await loadPool(anchor)
  if (pool.length < minStories) {
    throw new Error(`only ${pool.length} published stories this week; an episode needs ${minStories}`)
  }
  const prompt = buildPodcastSelectPrompt(
    pool.map(s => ({ id: s.id, issue: topIssueName(s), title: s.title || s.sourceTitle, summary: s.summary || '', relevance: s.relevance, emotionTag: s.emotionTag })),
    minStories,
    maxStories,
  )
  const result = await invokeStructured(podcastSelectResultSchema, selectModelTier, prompt, 'podcast-select')
  if (!result) throw new Error('podcast selection: the model returned no parsable output')

  const byId = new Map(pool.map(s => [s.id, s]))
  const ids = [...new Set(result.selectedIds)].filter(id => byId.has(id)).slice(0, maxStories)
  if (ids.length < minStories) {
    throw new Error(`podcast selection returned ${ids.length} valid stories; an episode needs ${minStories}`)
  }
  return ids.map((id, i) => toSelected(byId.get(id)!, i + 1))
}

/**
 * The dialogue for the selected stories. An invalid or unparsable answer gets one regeneration
 * with the problems listed; a second failure blocks the episode (never truncated or patched).
 */
export async function writeEpisodeScript(stories: SelectedStory[]): Promise<EpisodeScript> {
  const tier = config.podcast.scriptModelTier
  const refs = stories.map(s => ({ ref: s.snapshot.ref, title: s.snapshot.title, publisher: s.snapshot.publisher }))
  let problems: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildPodcastPrompt(stories.map(s => s.prompt), dialogueCharBudget(), problems)
    const dialogue = await invokeStructured(podcastDialogueSchema, tier, prompt, 'podcast-script')
    if (!dialogue) {
      problems = ['the previous answer did not match the output schema']
      continue
    }
    const validation = validateDialogue(dialogue, refs)
    if (validation.valid) return { dialogue, modelId: config.llm.models[tier].name }
    log.warn({ attempt, errors: validation.errors }, 'podcast dialogue invalid')
    problems = validation.errors
  }
  throw new PodcastBlockedError(`the dialogue is still invalid after one regeneration: ${problems.join('; ')}`)
}

/**
 * Plain-text show notes: the AI line first (the edited wording when a person changed the stories or
 * the script), the summary, then each story with our analysis and its source.
 */
export function buildShowNotes(summary: string, stories: EpisodeStory[], humanEdited: boolean): string {
  const items = stories.map(s => [
    `${s.ref}. ${s.title} (${s.publisher})`,
    ...(s.slug ? [`   Our AI analysis: ${config.siteUrl}/stories/${s.slug}`] : []),
    `   Source: ${s.sourceUrl}`,
  ].join('\n'))
  return [podcastEpisodeAiLine(humanEdited), '', summary.trim(), '', 'Stories in this episode:', ...items].join('\n')
}
