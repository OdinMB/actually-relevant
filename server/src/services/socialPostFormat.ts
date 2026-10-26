import { SOCIAL_POST_AI_SEGMENT } from '../lib/aiLabelCopy.js'

export interface MetaLineParts {
  issueName: string | null
  emotionTag: string | null
  publisherName: string
}

/** A story a channel can draft a post for: generateDraft refuses one without a title or summary. */
export interface SocialDraftStory {
  id: string
  title: string
  titleLabel: string | null
  summary: string
  relevanceSummary: string | null
  emotionTag: string | null
  issue: { name: string } | null
  feed: { title: string; displayTitle: string | null }
}

/** The metadata line's parts for a story: its issue, emotion and publisher (display title first). */
export function draftMetaParts(story: SocialDraftStory): MetaLineParts {
  return {
    issueName: story.issue?.name ?? null,
    emotionTag: story.emotionTag,
    publisherName: story.feed.displayTitle || story.feed.title,
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Metadata line shared by the Bluesky and Mastodon posts:
 * "Issue | Emotion | found on Publisher | AI-generated". Missing segments are left out.
 * The AI label rides in every post, because a reader of a single post never sees the bio
 * (AI Act Art. 50(4)). Each channel's blurb limit is computed from this line's length.
 */
export function buildMetaLine(parts: MetaLineParts): string {
  const segments = [parts.issueName, parts.emotionTag ? capitalize(parts.emotionTag) : null, `found on ${parts.publisherName}`, SOCIAL_POST_AI_SEGMENT].filter(
    Boolean,
  )
  return segments.join(' | ')
}
