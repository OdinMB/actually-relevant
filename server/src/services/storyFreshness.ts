/**
 * Newer coverage of chosen stories: an advisory check, with no model call, that later events may
 * have overtaken a story picked for an issue. A chosen story is flagged when
 * - its dedup cluster (the same event) holds a story reported at least `sameEventMinGapHours`
 *   after it (`same_event`), or
 * - its own feed later ran a nearly identical headline, however soon (`same_source`).
 * A later story counts once it reached analysis: `analyzed`, `selected`, `published`, or rejected as
 * a `duplicate`, which is how dedup files a later report of an event whose story is already
 * published. Nothing here writes, blocks or delays anything; callers show or announce the flags.
 */
import { type Prisma, RejectionReason, StoryStatus } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'

const HOUR_MS = 60 * 60 * 1000
/** Same-feed candidates are read from a day before the earliest chosen crawl, so a story the same crawl run saved a moment earlier counts. */
const SAME_CRAWL_MARGIN_MS = 24 * HOUR_MS

export type NewerCoverageReason = 'same_event' | 'same_source'

export interface NewerStory {
  id: string
  /** The story's title, else its source headline */
  title: string
  publisher: string
  reportedAt: Date
  reason: NewerCoverageReason
}

export interface NewerCoverage {
  storyId: string
  /** Newest first, at most `config.freshness.maxNewerPerStory` */
  newer: NewerStory[]
}

const STORY_FIELDS = {
  id: true,
  title: true,
  sourceTitle: true,
  feedId: true,
  clusterId: true,
  sourceDatePublished: true,
  dateCrawled: true,
} as const

type ChosenStory = Prisma.StoryGetPayload<{ select: typeof STORY_FIELDS }>
type CandidateStory = ChosenStory & { feed: { title: string; displayTitle: string | null } }

/** Stories that reached analysis (see the module comment). */
const REACHED_ANALYSIS: Prisma.StoryWhereInput = {
  OR: [
    { status: { in: [StoryStatus.analyzed, StoryStatus.selected, StoryStatus.published] } },
    { status: StoryStatus.rejected, rejectionReason: RejectionReason.duplicate },
  ],
}

/** The newer coverage of each of these stories that has any, in the given order. Reads only. */
export async function findNewerCoverage(storyIds: string[]): Promise<NewerCoverage[]> {
  if (storyIds.length === 0) return []
  const found = await prisma.story.findMany({ where: { id: { in: storyIds } }, select: STORY_FIELDS })
  if (found.length === 0) return []
  const byId = new Map(found.map(s => [s.id, s]))
  const chosen = storyIds.flatMap(id => byId.get(id) ?? [])

  const clusterIds = [...new Set(chosen.flatMap(s => s.clusterId ?? []))]
  const feedIds = [...new Set(chosen.map(s => s.feedId))]
  const earliestCrawl = Math.min(...chosen.map(s => s.dateCrawled.getTime()))
  const related: Prisma.StoryWhereInput[] = [
    ...(clusterIds.length > 0 ? [{ clusterId: { in: clusterIds } }] : []),
    { feedId: { in: feedIds }, dateCrawled: { gte: new Date(earliestCrawl - SAME_CRAWL_MARGIN_MS) } },
  ]
  const candidates = await prisma.story.findMany({
    where: { AND: [REACHED_ANALYSIS, { OR: related }] },
    select: { ...STORY_FIELDS, feed: { select: { title: true, displayTitle: true } } },
  })
  return newerCoverage(chosen, candidates)
}

/** When the source says it published the story, else when it was crawled; a source date after the crawl is not believed. */
export function reportedAt(story: { sourceDatePublished: Date | null; dateCrawled: Date }): Date {
  const source = story.sourceDatePublished
  return source && source <= story.dateCrawled ? source : story.dateCrawled
}

/** Pure: each chosen story's newer coverage among the candidates; stories without any are left out. */
export function newerCoverage(chosen: ChosenStory[], candidates: CandidateStory[]): NewerCoverage[] {
  const { sameEventMinGapHours, maxNewerPerStory } = config.freshness
  const minGapMs = sameEventMinGapHours * HOUR_MS
  return chosen.flatMap(story => {
    const since = reportedAt(story).getTime()
    const newer = new Map<string, NewerStory>()
    for (const other of candidates) {
      if (other.id === story.id) continue
      const later = reportedAt(other).getTime() - since
      const sameEvent = story.clusterId !== null && other.clusterId === story.clusterId && later >= minGapMs
      const sameSource = !sameEvent && other.feedId === story.feedId && later > 0 && nearlySameHeadline(story.sourceTitle, other.sourceTitle)
      if (!sameEvent && !sameSource) continue
      newer.set(other.id, {
        id: other.id,
        title: other.title || other.sourceTitle,
        publisher: other.feed.displayTitle || other.feed.title,
        reportedAt: reportedAt(other),
        reason: sameEvent ? 'same_event' : 'same_source',
      })
    }
    if (newer.size === 0) return []
    const listed = [...newer.values()].sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime()).slice(0, maxNewerPerStory)
    return [{ storyId: story.id, newer: listed }]
  })
}

// --- Headline similarity ---

/** Words too common to say two headlines are about the same thing ("us" is left in: it is often the country). */
const FILLER_WORDS = new Set(
  'a an the and or but nor of in on at to for from by with as is are was were be been being it its this that these those s after over into amid about than'.split(
    ' ',
  ),
)

function headlineWords(headline: string): Set<string> {
  return new Set(
    headline
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word && !FILLER_WORDS.has(word)),
  )
}

/** Two headlines nearly the same: enough shared words, and a high share of both headlines' words (Dice). */
export function nearlySameHeadline(a: string, b: string): boolean {
  const { sameSourceMinSharedWords, sameSourceMinSimilarity } = config.freshness
  const wordsA = headlineWords(a)
  const wordsB = headlineWords(b)
  let shared = 0
  for (const word of wordsA) if (wordsB.has(word)) shared++
  return shared >= sameSourceMinSharedWords && (2 * shared) / (wordsA.size + wordsB.size) >= sameSourceMinSimilarity
}
