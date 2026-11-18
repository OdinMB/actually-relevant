import { EMOTION_TAGS_PROMPT_BLOCK, formatIssuesBlock, formatArticlesBlock } from './shared.js'
import type { StoryForPreassess, IssueForPreassess } from './preassess.js'

/**
 * Cache: off. The rules and the issues come to about the 1,024-token minimum with the schema, and
 * the prompt runs only as an editor's bulk action.
 * House order (`.context/prompting.md`): the rules first, the run's issues next, the articles last.
 */
export function buildReclassifyPrompt(stories: StoryForPreassess[], issues: IssueForPreassess[]): string {
  return `<ROLE>
You are a news classifier categorizing articles into thematic issues and assigning emotion tags.
</ROLE>

<GOAL>
For each article: classify it into the single most relevant issue and assign an emotion tag. Do not rate the articles.
</GOAL>

${EMOTION_TAGS_PROMPT_BLOCK}

${formatIssuesBlock(issues)}

${formatArticlesBlock(stories)}`
}
