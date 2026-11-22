import type { OverviewRoleKind, PublicOverviewEntry, PublicOverviewHead } from '@shared/types'
import { SEO } from '../../lib/seo'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'

/*
 * The words an ongoing story's page, the `/ongoing` index and the story's link use
 * (`.context/public-website.md`, "Ongoing stories"). The AI label is not here: it is the owner's
 * wording, in `AI_DISCLOSURE_COPY.overviewLabel`.
 */

const ROLE_KIND_NAMES: Record<OverviewRoleKind, string> = {
  setback: 'setback',
  response: 'response',
  spread: 'spread',
  decision: 'decision',
  escalation: 'escalation',
  deescalation: 'de-escalation',
  money: 'money',
  science: 'science',
  people: 'people',
  milestone: 'milestone',
}

/** "Turning point · setback" (or "Turning point" for a kind this client does not know); null for a routine story. */
export function roleLine(entry: Pick<PublicOverviewEntry, 'role' | 'roleKind'>): string | null {
  if (entry.role !== 'turning_point') return null
  const kind = entry.roleKind ? ROLE_KIND_NAMES[entry.roleKind as OverviewRoleKind] : undefined
  return kind ? `Turning point · ${kind}` : 'Turning point'
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** "November 2026" (UTC, as the server's link preview writes it). */
export const monthYear = (iso: string): string => MONTH_YEAR.format(new Date(iso))

/** "Nov 18, 2026" (UTC). */
export const dayOf = (iso: string): string => DAY.format(new Date(iso))

/**
 * The header's first line: "Ongoing story · since November 2026"; "No new reporting since Nov 18, 2026"
 * while quiet, and once faded, which reads like a quiet one (its last story's day, not the fade's);
 * "Ended Nov 18, 2026" once closed otherwise, by an editor's Close.
 */
export function statusLine(o: Pick<PublicOverviewHead, 'status' | 'since' | 'closedAt' | 'closedReason' | 'lastEntryAt'>): string {
  const quietOrFaded = o.status === 'quiet' || (o.status === 'closed' && o.closedReason === 'faded')
  if (quietOrFaded && o.lastEntryAt) return `No new reporting since ${dayOf(o.lastEntryAt)}`
  if (o.status === 'closed' && o.closedAt) return `Ended ${dayOf(o.closedAt)}`
  return `Ongoing story · since ${monthYear(o.since)}`
}

/** "12 stories · last change Nov 18, 2026". */
export function countLine(o: Pick<PublicOverviewHead, 'stories' | 'lastChange'>): string {
  return `${o.stories} ${o.stories === 1 ? 'story' : 'stories'} · last change ${dayOf(o.lastChange)}`
}

const { lead, tail } = AI_DISCLOSURE_COPY.overviewLabel

/** The AI label as one line of text, the badge as the word "AI": the server's OVERVIEW_AI_LABEL. */
export const OVERVIEW_LABEL_TEXT = `${lead} ${AI_DISCLOSURE_COPY.badgeText}${tail}`

/**
 * The page's title and description, the AI label last. The backend writes the same for crawlers
 * that run no JavaScript (`overviewPreview` in server/src/services/pagePreviews.ts); change both together.
 */
export function overviewHead(o: Pick<PublicOverviewHead, 'title' | 'stories' | 'since'>): { title: string; description: string } {
  const count = `${o.stories} ${o.stories === 1 ? 'story' : 'stories'} since ${monthYear(o.since)}`
  return { title: `${o.title}: ongoing story - ${SEO.siteName}`, description: `${count}, followed as one ongoing story. ${OVERVIEW_LABEL_TEXT}` }
}

/** The page's address. */
export const overviewUrl = (slug: string): string => `${SEO.siteUrl}/ongoing/${encodeURIComponent(slug)}`

/** The methodology page's "Ongoing Stories" section, which the page's "How it works" leads to (shown only while the module is on, as the page). */
export const ONGOING_METHOD_ID = 'ongoing-stories'
export const ONGOING_METHOD_HREF = `/methodology#${ONGOING_METHOD_ID}`
