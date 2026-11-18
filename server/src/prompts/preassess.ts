import { promptParts, promptText, type PromptParts } from '../lib/promptCache.js'
import { EMOTION_TAGS_PROMPT_BLOCK, formatIssuesBlock, formatArticlesBlock } from './shared.js'
import type { StoryForPrompt, IssueForPrompt } from './shared.js'

// Re-export with legacy names for backwards compatibility
export type StoryForPreassess = StoryForPrompt
export type IssueForPreassess = IssueForPrompt

const PREASSESS_RULES = `<ROLE>
You are a relevance screener evaluating news articles for their importance to humanity.
</ROLE>

<GOAL>
For each article: classify it into the single most relevant issue, rate its relevance on a 1-10 scale, and assign an emotion tag.
</GOAL>

<RATING GUIDELINES>
1-2: Very low impact; limited effect on up to 10 million people.
3-4: Minor impact; affects 10-100 million people or narrowly shifts important norms, laws, or technology.
5-6: Moderate impact; affects 100+ million people or leads to broad, significant change in important systems, including those of a single country or region.
7-8: Major impact; affects over 1 billion people, shifts global systems, or slightly alters humanity's long-term prospects.
9-10: Exceptional impact; transforms the lives of 3+ billion people or fundamentally changes humanity's future.

Rate the development, risk or trend the article reports on, not the article's format: analysis, opinion and explainer pieces are rated by what they discuss. Count everyone the development affects, including people exposed to a risk it raises or lowers, drawing on your knowledge beyond the article; the article does not need to state how many people are affected. This rating is a screen: the full assessment weighs the article type and other limiting factors later, so when an article sits between two adjacent levels, choose the higher one.

The rating does not decide the issue: choose the issue by the article's subject, independently of the rating and of who is affected.
</RATING GUIDELINES>

${EMOTION_TAGS_PROMPT_BLOCK}`

/**
 * One batch's screen: issue, rating and emotion tag for each article.
 *
 * Cache: on. The rules and the run's issues come to about 1,400 tokens with the output schema, and a
 * pre-assessment run sends a batch of up to `config.preassess.batchSize` articles at a time, several
 * batches within the cache's 30 minutes. The issues are fixed for the run, so they close the cached
 * part; the articles are the call's data.
 */
export function buildPreassessPromptParts(stories: StoryForPreassess[], issues: IssueForPreassess[]): PromptParts {
  return promptParts(`${PREASSESS_RULES}\n\n${formatIssuesBlock(issues)}`, formatArticlesBlock(stories))
}

export function buildPreassessPrompt(stories: StoryForPreassess[], issues: IssueForPreassess[]): string {
  return promptText(buildPreassessPromptParts(stories, issues))
}
