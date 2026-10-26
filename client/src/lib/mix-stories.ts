import type { PublicStory } from '@shared/types'

export interface StoryBuckets {
  uplifting: PublicStory[]
  calm: PublicStory[]
  negative: PublicStory[]
}

/**
 * Mix story buckets for a fixed number of slots (homepage sections).
 *
 * At 100%: strictly uplifting only — no backfill from calm or negative.
 * At 0–75%: uplifting+calm are combined as "positive" and mixed with negative
 * using the same ratio logic as before.
 */
export function mixHomepageStories(buckets: StoryBuckets, slots: number, positivity: number): PublicStory[] {
  // At 100%, strict uplifting only — return however many we have, up to slots
  if (positivity === 100) {
    return buckets.uplifting.slice(0, slots).sort(byDateDesc)
  }

  // For all other settings, combine uplifting+calm as "positive"
  const positive = [...buckets.uplifting, ...buckets.calm].sort(byDateDesc)
  const negative = buckets.negative

  const positiveCount = Math.round((slots * positivity) / 100)
  const negativeCount = slots - positiveCount

  const picked: PublicStory[] = []
  const usedIds = new Set<string>()

  // Take from positive bucket
  for (const s of positive) {
    if (picked.length >= positiveCount) break
    picked.push(s)
    usedIds.add(s.id)
  }

  // Take from negative bucket
  for (const s of negative) {
    if (picked.length >= positiveCount + negativeCount) break
    if (!usedIds.has(s.id)) {
      picked.push(s)
      usedIds.add(s.id)
    }
  }

  // Fill shortfalls from either bucket
  if (picked.length < slots) {
    for (const s of [...positive, ...negative]) {
      if (picked.length >= slots) break
      if (!usedIds.has(s.id)) {
        picked.push(s)
        usedIds.add(s.id)
      }
    }
  }

  return picked.sort(byDateDesc)
}

/**
 * Pick the hero story from all issue buckets based on positivity.
 * Returns the most recent story from the appropriate emotion pool.
 */
export function pickHero(storiesByIssue: Record<string, StoryBuckets>, positivity: number): PublicStory | null {
  const all: PublicStory[] = []

  for (const buckets of Object.values(storiesByIssue)) {
    if (positivity === 100) {
      all.push(...buckets.uplifting)
    } else if (positivity === 0) {
      all.push(...buckets.negative)
    } else if (positivity > 50) {
      all.push(...buckets.uplifting, ...buckets.calm)
    } else if (positivity < 50) {
      all.push(...buckets.negative)
    } else {
      // 50%: all stories
      all.push(...buckets.uplifting, ...buckets.calm, ...buckets.negative)
    }
  }

  if (all.length === 0) return null

  all.sort(byDateDesc)
  return all[0] ?? null
}

/**
 * Map positivity slider position to emotion tag filters for server-side pagination.
 * Returns undefined at 50% (no filter — show all stories).
 */
export function positivityToEmotionTags(positivity: number): string[] | undefined {
  switch (positivity) {
    case 0:
      return ['frustrating', 'scary']
    case 25:
      return ['frustrating', 'scary', 'calm']
    case 50:
      return undefined
    case 75:
      return ['uplifting', 'calm']
    case 100:
      return ['uplifting']
    default:
      return undefined
  }
}

function byDateDesc(a: PublicStory, b: PublicStory): number {
  const da = new Date(a.datePublished ?? a.dateCrawled).getTime()
  const db = new Date(b.datePublished ?? b.dateCrawled).getTime()
  return db - da
}
