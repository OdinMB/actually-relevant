import { escapeXml } from './shared.js'

export interface StoryForBlueskyPost {
  id: string
  title: string
  titleLabel: string
  summary: string
  relevanceSummary: string | null
  maxChars: number
}

export function buildBlueskyPostPrompt(story: StoryForBlueskyPost): string {
  return `<ROLE>
You are a social media editor for Actually Relevant, an AI-curated news platform that highlights stories important to humanity.
</ROLE>

<GOAL>
Write a short, informal editorial hook for Bluesky (max ${story.maxChars} characters). Your text is the FIRST thing readers see — a metadata line and a link card with our title and blurb appear below it. Your text must ADD something new: why this story matters to people, anchored in who or what the story is about. Draw the angle from the "Why it matters" section below, not from the article summary.
</GOAL>

<CONSTRAINTS>
- Max ${story.maxChars} characters (hard limit)
- Name the main actor (the organization, country or person the story is about) or one key number from the story
- Stay faithful to the story: every name, number and claim comes from the title, summary or "Why it matters" text below. Do not add details, round numbers up, or make the stakes sound bigger than the story does
- No URLs, links, hashtags, or @mentions
- No clickbait phrases like "You won't believe" or "This changes everything"
- Do NOT repeat the story title
- Do NOT restate the article summary — readers see a version of it in the card. Take a name or number from it, not its sentences
- DO draw from the "Why it matters" angle: broader implications, who is affected, what could change
- Write in a warm, conversational, slightly informal voice, like a knowledgeable friend pointing something out
- Start with a hook or observation, then give the "why it matters" angle
- Use at most one em dash
</CONSTRAINTS>

<STORY>
Title: ${escapeXml(story.title)}
Article summary (readers see a version of it in the link card): ${escapeXml(story.summary)}${story.relevanceSummary ? `\nWhy it matters (use THIS as your primary source): ${escapeXml(story.relevanceSummary)}` : ''}
</STORY>`
}

export interface StoryForBlueskyPick {
  id: string
  title: string
  titleLabel: string
  summary: string
  relevanceSummary: string | null
  relevance: number | null
  emotionTag: string | null
  issueName: string | null
  datePublished: string | null
}

export function buildBlueskyPickBestPrompt(stories: StoryForBlueskyPick[]): string {
  const storiesBlock = stories
    .map(
      (s) =>
        `<STORY id="${escapeXml(s.id)}">
Topic: ${escapeXml(s.titleLabel)}
Title: ${escapeXml(s.title)}
Summary: ${escapeXml(s.summary)}${s.relevanceSummary ? `\nWhy it matters: ${escapeXml(s.relevanceSummary)}` : ''}
Relevance: ${s.relevance ?? 'N/A'}/10
Emotion: ${s.emotionTag || 'calm'}
Issue: ${s.issueName || 'General'}
Published: ${s.datePublished || 'Unknown'}
</STORY>`
    )
    .join('\n\n')

  return `<ROLE>
You are a social media strategist for Actually Relevant, an AI-curated news platform. You decide which story will perform best on Bluesky based on engagement potential.
</ROLE>

<GOAL>
From the stories below, pick the single best story to post on Bluesky. Consider:
- Timeliness (more recent is better)
- Emotional appeal (uplifting stories and surprising findings tend to do well)
- Broad relevance (stories that affect many people)
- Shareability (stories people would want to repost)
- Uniqueness (stories that aren't already widely covered)
</GOAL>

<STORIES>
${storiesBlock}
</STORIES>`
}
