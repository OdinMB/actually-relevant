/**
 * What an issue's email shows in the inbox before it is opened: the subject line and the hidden
 * preview text (preheader). Built from the issue's stored content and its stories' stored
 * relevance, with no model call; the stories are the headings the email shows, so a heading edited
 * by hand appears as edited. The archive and the web edition keep the issue title.
 *
 * - Subject: `<label>: <lead headline> and <N> more`, where the label is "Week 43" for a weekly title
 *   ("Week 43, 2026", `getWeekTitle()`) and the whole title otherwise, the lead is the story with the
 *   highest `relevance` (ties and unrated stories in the issue's order, unrated last) and N the other
 *   stories. One story: no count. None: the title alone, as before.
 * - Preview text: the next two stories by the same ranking, empty below two stories.
 *
 * Both are plain text on one line; `renderHtml()` escapes the preview text into the email.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { storyHeadings } from './newsletterContent.js'

/** A story as the email shows it: its heading, and its stored rating (null: unrated or not found). */
export interface InboxStory {
  headline: string
  relevance: number | null
}

export interface InboxPreview {
  subject: string
  /** Empty when the issue has fewer than two stories: the email then carries no preview block. */
  preheader: string
}

/** The longest subject, in characters, before the lead headline is shortened. */
export const SUBJECT_MAX_CHARS = 95
/** A shortened headline keeps at least this many characters, however long the title in front of it. */
const MIN_HEADLINE_CHARS = 30
/** How many stories after the lead the preview text names. */
const PREVIEW_STORIES = 2

/** The title `getWeekTitle()` gives a weekly issue, "Week 43, 2026"; its first group is the label. */
const WEEK_TITLE = /^(Week \d{1,2}), \d{4}$/

/** Line breaks, tabs and other control characters become single spaces: a subject is one line. */
const oneLine = (text: string) => text.replace(/[\s\p{Cc}]+/gu, ' ').trim()

/** "Week 43" for a weekly title, else the title itself. */
function issueLabel(title: string): string {
  const line = oneLine(title)
  return WEEK_TITLE.exec(line)?.[1] ?? line
}

/** `text` in at most `max` characters: cut at a word where it can be, ending in an ellipsis. */
function shorten(text: string, max: number): string {
  // By code point, so an emoji is never split in half
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const cut = chars.slice(0, max - 1).join('')
  const endsAtWord = /\s/.test(chars[max - 1] ?? '')
  const atWord = endsAtWord ? cut : cut.replace(/\s+\S*$/, '')
  // A word longer than half the room is cut where the room ends
  const kept = atWord.length >= cut.length / 2 ? atWord : cut
  return `${kept.replace(/[\s,;:–—-]+$/u, '')}…`
}

/** Most relevant first; the sort is stable, so ties keep the issue's order. Unrated stories go last. */
function ranked(stories: InboxStory[]): InboxStory[] {
  const rank = (story: InboxStory) => story.relevance ?? -1
  return [...stories].sort((a, b) => rank(b) - rank(a))
}

/** The subject line and preview text for an issue with this title and these stories (in the email's order). */
export function inboxPreview(title: string, stories: InboxStory[]): InboxPreview {
  const [lead, ...others] = ranked(stories)
  if (!lead) return { subject: title, preheader: '' }

  const prefix = `${issueLabel(title)}: `
  const suffix = others.length > 0 ? ` and ${others.length} more` : ''
  const room = Math.max(MIN_HEADLINE_CHARS, SUBJECT_MAX_CHARS - Array.from(prefix + suffix).length)
  const subject = `${prefix}${shorten(oneLine(lead.headline), room)}${suffix}`

  const next = others.slice(0, PREVIEW_STORIES).map(story => oneLine(story.headline))
  return { subject, preheader: next.length > 0 ? `Also: ${next.join(' · ')}` : '' }
}

/** The stories the issue's email shows, in its order, each with its story's stored relevance. */
export async function inboxStories(content: string, client: Prisma.TransactionClient = prisma): Promise<InboxStory[]> {
  const headings = storyHeadings(content)
  const ids = [...new Set(headings.flatMap(heading => (heading.storyId ? [heading.storyId] : [])))]
  const rows = ids.length > 0 ? await client.story.findMany({ where: { id: { in: ids } }, select: { id: true, relevance: true } }) : []
  const relevance = new Map(rows.map(row => [row.id, row.relevance]))
  return headings.map(({ headline, storyId }) => ({ headline, relevance: storyId ? (relevance.get(storyId) ?? null) : null }))
}

/** The subject line and preview text of an issue as it is stored now. */
export async function loadInboxPreview(newsletter: { title: string; content: string }, client: Prisma.TransactionClient = prisma): Promise<InboxPreview> {
  return inboxPreview(newsletter.title, await inboxStories(newsletter.content, client))
}
