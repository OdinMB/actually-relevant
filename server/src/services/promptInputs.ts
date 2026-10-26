/**
 * What the model call sites send: pure functions from the rows a service loads to its prompt
 * builder's input. The services and the model-eval harness both call them, so the eval measures
 * the prompts production sends (`.context/model-eval.md`). The Bluesky and Mastodon draft inputs
 * live beside their blurb budgets (`bluesky.ts`, `mastodon.ts`).
 *
 * No I/O: the eval imports this module, so it imports only config and prompt types
 * (`scripts/eval/imports.test.ts` holds it to that). `promptInputs.test.ts` pins the prompts.
 */
import { config } from '../config.js'
import type { Guidelines } from '../prompts/shared.js'
import type { StoryForSelect } from '../prompts/select.js'
import type { CandidateStory } from '../prompts/related-stories.js'
import type { StoryForBlueskyPick } from '../prompts/bluesky.js'
import type { StoryForNewsletterSelect } from '../prompts/newsletter-select.js'
import type { StoryForPodcast } from '../prompts/podcast.js'
import type { StoryForPodcastSelect } from '../prompts/podcast-select.js'

// --- Full assessment (analysis.ts assessStory) ---

interface GuidelineFields {
  promptFactors: string
  promptAntifactors: string
  promptRatings: string
}

export interface AssessPromptInput {
  title: string
  /** The whole source text; buildAssessPrompt cuts it to `config.assess.contentMaxLength`. */
  content: string
  publisher: string
  url: string
  guidelines: Guidelines
}

/** The story's own issue guidelines, else its feed's; the feed title as publisher. */
export function assessPromptInput(story: {
  sourceTitle: string
  sourceContent: string
  sourceUrl: string
  issue: GuidelineFields | null
  feed: { title: string; issue: GuidelineFields }
}): AssessPromptInput {
  const issue = story.issue ?? story.feed.issue
  return {
    title: story.sourceTitle,
    content: story.sourceContent,
    publisher: story.feed.title,
    url: story.sourceUrl,
    guidelines: { factors: issue.promptFactors, antifactors: issue.promptAntifactors, ratings: issue.promptRatings },
  }
}

// --- Editorial selection (analysis.ts selectStories) ---

export function selectPromptStory(s: {
  id: string
  title: string | null
  summary: string | null
  relevanceReasons: string | null
  antifactors: string | null
  relevanceCalculation: string | null
  emotionTag: string | null
  sourceDatePublished: Date | null
}): StoryForSelect {
  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    relevanceReasons: s.relevanceReasons,
    antifactors: s.antifactors,
    relevanceCalculation: s.relevanceCalculation,
    emotionTag: s.emotionTag,
    sourceDatePublished: s.sourceDatePublished?.toISOString() ?? null,
  }
}

/** How many of a selection pool the model is asked to pick. */
export const selectCount = (poolSize: number): number => Math.ceil(poolSize * config.selection.ratio)

// --- Related stories (relatedStories.ts) ---

/** A story row as the related-stories queries return it. */
export interface RelatedRow {
  id: string
  title: string | null
  title_label: string | null
}

export const relatedSource = (row: Omit<RelatedRow, 'id'>): { titleLabel: string | null; title: string | null } => ({
  titleLabel: row.title_label,
  title: row.title,
})

export const relatedCandidate = (row: RelatedRow): CandidateStory => ({ id: row.id, titleLabel: row.title_label, title: row.title })

/** The model re-ranks only when there are more candidates than display slots. */
export const relatedNeedsRanking = (candidateCount: number): boolean => candidateCount > config.relatedStories.displayCount

// --- Social story pick (socialMedia.ts pickBestStoryForSocial) ---

export function socialPickStory(s: {
  id: string
  title: string | null
  sourceTitle: string
  titleLabel: string | null
  summary: string | null
  relevanceSummary: string | null
  relevance: number | null
  emotionTag: string | null
  issue: { name: string } | null
  datePublished: Date | null
}): StoryForBlueskyPick {
  return {
    id: s.id,
    title: s.title || s.sourceTitle,
    titleLabel: s.titleLabel || '',
    summary: s.summary || '',
    relevanceSummary: s.relevanceSummary,
    relevance: s.relevance,
    emotionTag: s.emotionTag,
    issueName: s.issue?.name ?? null,
    datePublished: s.datePublished?.toISOString() ?? null,
  }
}

// --- Newsletter selection and story order (newsletter.ts pickShortlist, buildContent) ---

/** Fixed display order for top-level issues in the newsletter. */
const ISSUE_ORDER = ['human-development', 'planet-climate', 'existential-threats', 'science-technology']

export function newsletterIssueSortIndex(slug: string): number {
  const idx = ISSUE_ORDER.indexOf(slug)
  return idx >= 0 ? idx : ISSUE_ORDER.length
}

interface WithIssue<I> {
  issue: I | null
  feed?: { issue: I | null } | null
}

type NamedIssue = { name: string; parentId: string | null; parent: { name: string } | null }
type SluggedIssue = { name: string; slug: string; parentId: string | null; parent: { name: string; slug: string } | null }

/** The longlist as the selection prompt lists it, each story under its top-level issue name. */
export function newsletterSelectInput(
  stories: (WithIssue<NamedIssue> & { id: string; title: string | null; sourceTitle: string; summary: string | null; emotionTag: string | null })[],
): { stories: StoryForNewsletterSelect[]; issueNames: string[] } {
  const storiesForPrompt = stories.map(s => {
    const issue = s.issue ?? s.feed?.issue
    const issueName = issue?.parentId && issue.parent ? issue.parent.name : (issue?.name ?? 'General')
    return {
      id: s.id,
      title: s.title || s.sourceTitle,
      summary: s.summary,
      issueName,
      emotionTag: s.emotionTag,
    }
  })
  return { stories: storiesForPrompt, issueNames: [...new Set(storiesForPrompt.map(s => s.issueName))].sort() }
}

/** A story's top-level (parent) issue, or General. */
export function newsletterIssue(story: WithIssue<SluggedIssue>): { name: string; slug: string } {
  const issue = story.issue ?? story.feed?.issue
  if (!issue) return { name: 'General', slug: 'general-news' }
  if (issue.parentId && issue.parent) {
    return { name: issue.parent.name, slug: issue.parent.slug }
  }
  return { name: issue.name, slug: issue.slug }
}

type NewsletterStory = WithIssue<SluggedIssue> & { title: string | null; sourceTitle: string }

/** The issue's stories in fixed issue order, then by title; a stable sort, so ties keep `stories` order. */
export function newsletterOrder<S extends NewsletterStory>(stories: S[]): S[] {
  return [...stories].sort((a, b) => {
    const orderDiff = newsletterIssueSortIndex(newsletterIssue(a).slug) - newsletterIssueSortIndex(newsletterIssue(b).slug)
    if (orderDiff !== 0) return orderDiff
    const titleA = a.title || a.sourceTitle || ''
    const titleB = b.title || b.sourceTitle || ''
    return titleA.localeCompare(titleB)
  })
}

// --- Podcast story selection and dialogue (podcastScript.ts) ---

type PodcastIssue = { name: string; parent: { name: string } | null }

/** A story's top-level issue, title and publisher, as the podcast prompts and episode snapshots show them. */
export function podcastHeading(s: {
  title: string | null
  sourceTitle: string
  issue: PodcastIssue | null
  feed: { title: string; displayTitle: string | null; issue: PodcastIssue | null } | null
}): { issue: string; title: string; publisher: string } {
  const issue = s.issue ?? s.feed?.issue
  return {
    issue: issue?.parent?.name ?? issue?.name ?? 'General',
    title: s.title || s.sourceTitle,
    publisher: s.feed?.displayTitle || s.feed?.title || 'Unknown',
  }
}

/** A pool story as the selection prompt lists it, under its heading. */
export function podcastSelectStory(
  s: { id: string; summary: string | null; relevance: number | null; emotionTag: string | null },
  heading: { issue: string; title: string },
): StoryForPodcastSelect {
  return {
    id: s.id,
    issue: heading.issue,
    title: heading.title,
    summary: s.summary || '',
    relevance: s.relevance,
    emotionTag: s.emotionTag,
  }
}

/** A story's dialogue-prompt material under the episode's frozen snapshot (its ref, issue, title and publisher). */
export function podcastScriptStory(
  s: { summary: string | null; relevanceSummary?: string | null; relevanceReasons: string | null; antifactors: string | null },
  snapshot: { ref: number; issue: string; title: string; publisher: string },
): StoryForPodcast {
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
