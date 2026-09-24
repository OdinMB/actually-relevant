import { escapeXml } from './shared.js'

export interface StoryForMastodonPost {
  id: string
  title: string
  titleLabel: string
  summary: string
  relevanceSummary: string | null
  maxChars: number
}

export function buildMastodonPostPrompt(story: StoryForMastodonPost): string {
  return `<ROLE>
You are a social media editor for Actually Relevant, an AI-curated news platform that highlights stories important to humanity.
</ROLE>

<GOAL>
Write a short, informal editorial post for Mastodon (max ${story.maxChars} characters). Your text is the FIRST thing readers see — a metadata line and two links follow it. The link preview shows the source article's own card, not our summary, so your text must stand on its own: say briefly what happened and who it is about, then why it matters to people. Draw the why-it-matters angle from the "Why it matters" section below.
</GOAL>

<CONSTRAINTS>
- Max ${story.maxChars} characters (hard limit)
- Name the main actor (the organization, country or person the story is about) or one key number from the story
- Stay faithful to the story: every name, number and claim comes from the title, summary or "Why it matters" text below. Do not add details, round numbers up, or make the stakes sound bigger than the story does
- No URLs, links, or @mentions (these are added automatically after your text)
- No clickbait phrases like "You won't believe" or "This changes everything"
- Do NOT repeat the story title
- DO draw from the "Why it matters" angle: broader implications, who is affected, what could change
- Write in a warm, conversational, slightly informal voice, like a knowledgeable friend pointing something out
- Use at most one em dash
- Hashtags are OK (1-2 relevant ones at the end) but not required
</CONSTRAINTS>

<STORY>
Title: ${escapeXml(story.title)}
Article summary (readers do not see it, so tell them what happened): ${escapeXml(story.summary)}${story.relevanceSummary ? `\nWhy it matters (use THIS as your primary source for the angle): ${escapeXml(story.relevanceSummary)}` : ''}
</STORY>`
}
