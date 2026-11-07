/**
 * The site's Mood Dial (`mix`) for the RSS feeds. Same names, numbers and rules as the website:
 * `client/src/contexts/PositivityContext.tsx` (names, snapping) and `client/src/lib/mix-stories.ts`
 * (which stories a position shows). The client cannot share this file (the server does not import
 * TypeScript from `shared/`), so change both together.
 */

/** Dial positions and their names, as the site's `?mix=` accepts them. */
export const FEED_MIX_NAMES: Record<FeedMix, string> = {
  0: 'heavy',
  25: 'mostly-heavy',
  50: 'balanced',
  75: 'mostly-uplifting',
  100: 'uplifting',
}

export type FeedMix = 0 | 25 | 50 | 75 | 100

/** The far end, "Only uplifting": the Actually Uplifting edition. */
export const UPLIFTING_FEED_MIX = 100 satisfies FeedMix

const POSITIONS: FeedMix[] = [0, 25, 50, 75, 100]

/** The dial position a `mix` value names (a name, or a number 0-100 snapped to the nearest position), or null. */
export function parseFeedMix(raw: string): FeedMix | null {
  const value = raw.trim().toLowerCase()
  for (const position of POSITIONS) {
    if (FEED_MIX_NAMES[position] === value) return position
  }
  if (!/^\d{1,3}$/.test(value)) return null
  const parsed = Number(value)
  if (parsed > 100) return null
  // Snap to the nearest position; a tie goes to the lower one, as on the site
  return POSITIONS.reduce((best, p) => (Math.abs(parsed - p) < Math.abs(parsed - best) ? p : best), POSITIONS[0]!)
}

interface Dated {
  id: string
  datePublished: Date | string | null
  dateCrawled: Date | string
}

const time = (s: Dated) => new Date(s.datePublished ?? s.dateCrawled).getTime()
const byDateDesc = (a: Dated, b: Dated) => time(b) - time(a)

/**
 * The feed's stories at a dial position below "Only uplifting", as the homepage mixes a section:
 * `size` slots, round(size × mix / 100) from the positive pool (uplifting and calm), the rest from
 * the negative pool (frustrating and scary), a shortfall in either filled from the other, newest
 * first. Each pool arrives newest first.
 */
export function mixFeedStories<T extends Dated>(positive: T[], negative: T[], size: number, mix: FeedMix): T[] {
  const positiveCount = Math.round((size * mix) / 100)
  const picked = [...positive.slice(0, positiveCount), ...negative.slice(0, size - positiveCount)]
  const used = new Set(picked.map(s => s.id))
  for (const s of [...positive, ...negative]) {
    if (picked.length >= size) break
    if (!used.has(s.id)) {
      picked.push(s)
      used.add(s.id)
    }
  }
  return picked.sort(byDateDesc)
}
