/**
 * The podcast's eval inputs and scoring, shared by the large-tier suite and the `podcast`
 * recalibrate step: the cached pool as selection input, a fixed pick of stories as dialogue input,
 * and the dialogue scored with production's own validation (checkDialogue).
 */
import { config } from '../../../config.js'
import { buildPodcastPrompt, type StoryForPodcast } from '../../../prompts/podcast.js'
import { buildPodcastSelectPrompt, type StoryForPodcastSelect } from '../../../prompts/podcast-select.js'
import type { PodcastDialogue, PodcastSelectResult } from '../../../schemas/llm.js'
import { assembleSpokenSegments, dialogueCharBudget, renderScript } from '../../../services/podcastDialogue.js'
import { checkDialogue, mean, type DialogueCheck } from '../checks.js'
import type { PodcastFixtureStory, PodcastItem } from '../fixtures.js'
import type { CallRecord } from '../types.js'
import { parsedOf } from './shared.js'

/** A cached story with an id (older caches had none: their position stands in). */
const withId = (s: PodcastFixtureStory, i: number) => ({ ...s, id: s.id ?? `story-${i + 1}` })

export function podcastPool(p: PodcastItem): (PodcastFixtureStory & { id: string })[] {
  return p.stories.map(withId)
}

/**
 * The dialogue's fixed input: the most relevant story of each issue, then the next most relevant,
 * up to the episode's maximum (the cache's order where relevance is missing).
 */
export function podcastEpisodeStories(p: PodcastItem): StoryForPodcast[] {
  const pool = podcastPool(p)
  const byRelevance = [...pool].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
  const picked: typeof pool = []
  for (const s of byRelevance) if (!picked.some(x => x.category === s.category)) picked.push(s)
  for (const s of byRelevance) if (!picked.includes(s)) picked.push(s)
  return picked.slice(0, config.podcast.maxStories).map((s, i) => ({
    ref: i + 1,
    issue: s.category,
    title: s.title,
    publisher: s.publisher,
    summary: s.summary,
    whyItMatters: s.relevanceSummary || s.relevanceReasons,
    limitingFactors: s.antifactors,
  }))
}

export const podcastPrompt = (p: PodcastItem) => buildPodcastPrompt(podcastEpisodeStories(p), dialogueCharBudget('weekly'), 'weekly')

const selectStory = (s: PodcastFixtureStory & { id: string }): StoryForPodcastSelect => ({
  id: s.id, issue: s.category, title: s.title, summary: s.summary, relevance: s.relevance ?? null, emotionTag: s.emotionTag ?? null,
})

export const podcastSelectPrompt = (p: PodcastItem) =>
  buildPodcastSelectPrompt(podcastPool(p).map(selectStory), config.podcast.minStories, config.podcast.maxStories, 'weekly')

export const scoreDialogue = (p: PodcastItem, dialogue: PodcastDialogue): DialogueCheck =>
  checkDialogue(dialogue, podcastEpisodeStories(p))

export interface PodcastArmMetrics {
  /** Dialogues production would reject (and regenerate once). */
  invalid: number
  validationErrors: number
  longSentenceShare: number | null
  publisherCoverage: number | null
  failures: number
}

export function scorePodcast(ps: PodcastItem[], recs: CallRecord<PodcastDialogue>[]): PodcastArmMetrics {
  const checks = ps.flatMap((p, i) => {
    const d = parsedOf(recs[i])
    return d == null ? [] : [scoreDialogue(p, d)]
  })
  return {
    invalid: checks.filter(c => c.errors.length > 0).length,
    validationErrors: checks.reduce((n, c) => n + c.errors.length, 0),
    longSentenceShare: mean(checks.flatMap(c => (c.longSentenceShare == null ? [] : [c.longSentenceShare]))),
    publisherCoverage: mean(checks.flatMap(c => (c.publisherCoverage == null ? [] : [c.publisherCoverage]))),
    failures: recs.filter(r => r.outcome !== 'ok' && r.outcome !== 'skipped').length,
  }
}

/** The dialogue as the owner rates it: the spoken episode, "HOST A: …". */
export const renderDialogue = (d: PodcastDialogue) => renderScript(assembleSpokenSegments(d, 'weekly'))

export interface SelectionCheck {
  /** Valid, distinct pool ids in the answer. */
  picks: string[]
  invalidIds: number
  countOk: boolean
  /** Picks span as many issues as they can (one per issue until the pool's issues run out). */
  distinctIssuesOk: boolean
}

export function checkPodcastSelection(p: PodcastItem, result: PodcastSelectResult): SelectionCheck {
  const pool = podcastPool(p)
  const ids = new Set(pool.map(s => s.id))
  const picks = [...new Set(result.selectedIds)].filter(id => ids.has(id))
  const issueOf = new Map(pool.map(s => [s.id, s.category]))
  const issues = new Set(picks.map(id => issueOf.get(id)))
  const available = new Set(pool.map(s => s.category)).size
  return {
    picks,
    invalidIds: result.selectedIds.filter(id => !ids.has(id)).length,
    countOk: picks.length >= config.podcast.minStories && picks.length <= config.podcast.maxStories && picks.length === result.selectedIds.length,
    distinctIssuesOk: issues.size >= Math.min(available, picks.length),
  }
}
