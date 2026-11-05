/**
 * Newer coverage of chosen stories, with no model call: later stories that may have overtaken a
 * story picked for an issue. A chosen story has newer coverage when
 * - its dedup cluster (the same event) holds a story reported at least `sameEventMinGapHours`
 *   after it (`same_event`), or
 * - its own feed later ran a nearly identical headline, however soon (`same_source`).
 * A later story counts once it reached analysis: `analyzed`, `selected`, `published`, or rejected as
 * a `duplicate`, which is how dedup files a later report of an event whose story is already
 * published. Both uses only read:
 * - `findNewerCoverage`: the flags the admin issue page shows under a selected story;
 * - `preferNewerCoverage`: the newsletter's select move gives each pick's place to the newest later
 *   story of the same event (`same_event` only) the issue can carry: published, on its longlist, in
 *   the pick's section. A pick without one stays, flagged; a `same_source` match is only a flag.
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

const CANDIDATE_FIELDS = { ...STORY_FIELDS, status: true, feed: { select: { title: true, displayTitle: true } } } as const

type ChosenStory = Prisma.StoryGetPayload<{ select: typeof STORY_FIELDS }>
type CandidateStory = Prisma.StoryGetPayload<{ select: typeof CANDIDATE_FIELDS }>

/** Stories that reached analysis (see the module comment). */
const REACHED_ANALYSIS: Prisma.StoryWhereInput = {
  OR: [
    { status: { in: [StoryStatus.analyzed, StoryStatus.selected, StoryStatus.published] } },
    { status: StoryStatus.rejected, rejectionReason: RejectionReason.duplicate },
  ],
}

/** The newer coverage of each of these stories that has any, in the given order. Reads only. */
export async function findNewerCoverage(storyIds: string[]): Promise<NewerCoverage[]> {
  const { chosen, candidates } = await readCoverage(storyIds)
  return newerCoverage(chosen, candidates)
}

/** A pick the newsletter's selection gave way to newer coverage of it. */
export interface ShortlistReplacement {
  replacedId: string
  /** The pick's title, else its source headline */
  replacedTitle: string
  newerId: string
  newerTitle: string
  reason: NewerCoverageReason
}

export interface PreferredShortlist {
  storyIds: string[]
  replaced: ShortlistReplacement[]
}

/**
 * The shortlist with each pick that has a later story of the same event the issue can carry replaced
 * by it (`replaceWithNewer`); `sections` is the longlist, each story id with its newsletter section.
 * Reads only.
 */
export async function preferNewerCoverage(shortlist: string[], sections: ReadonlyMap<string, string>): Promise<PreferredShortlist> {
  const { chosen, candidates } = await readCoverage(shortlist)
  return replaceWithNewer(shortlist, chosen, candidates, sections)
}

/** The chosen stories that exist, in the given order, and the stories that may be newer coverage of them. */
async function readCoverage(storyIds: string[]): Promise<{ chosen: ChosenStory[]; candidates: CandidateStory[] }> {
  if (storyIds.length === 0) return { chosen: [], candidates: [] }
  const found = await prisma.story.findMany({ where: { id: { in: storyIds } }, select: STORY_FIELDS })
  if (found.length === 0) return { chosen: [], candidates: [] }
  const byId = new Map(found.map(s => [s.id, s]))
  const chosen = storyIds.flatMap(id => byId.get(id) ?? [])

  const clusterIds = [...new Set(chosen.flatMap(s => s.clusterId ?? []))]
  const feedIds = [...new Set(chosen.map(s => s.feedId))]
  const earliestCrawl = Math.min(...chosen.map(s => s.dateCrawled.getTime()))
  const related: Prisma.StoryWhereInput[] = [
    ...(clusterIds.length > 0 ? [{ clusterId: { in: clusterIds } }] : []),
    { feedId: { in: feedIds }, dateCrawled: { gte: new Date(earliestCrawl - SAME_CRAWL_MARGIN_MS) } },
  ]
  const candidates = await prisma.story.findMany({ where: { AND: [REACHED_ANALYSIS, { OR: related }] }, select: CANDIDATE_FIELDS })
  return { chosen, candidates }
}

/** When the source says it published the story, else when it was crawled; a source date after the crawl is not believed. */
export function reportedAt(story: { sourceDatePublished: Date | null; dateCrawled: Date }): Date {
  const source = story.sourceDatePublished
  return source && source <= story.dateCrawled ? source : story.dateCrawled
}

/** Pure: each chosen story's newer coverage among the candidates; stories without any are left out. */
export function newerCoverage(chosen: ChosenStory[], candidates: CandidateStory[]): NewerCoverage[] {
  const { maxNewerPerStory } = config.freshness
  return chosen.flatMap(story => {
    const newer = newerStoriesOf(story, candidates)
    return newer.length === 0 ? [] : [{ storyId: story.id, newer: newer.slice(0, maxNewerPerStory) }]
  })
}

/**
 * Pure: the shortlist with each pick replaced, in place, by the newest later story of the same event
 * (`same_event`) that the issue can carry: published, on the longlist (`sections`: each longlist
 * story's newsletter section) under the pick's own section, and not on the shortlist already nor
 * taken by an earlier pick. A `same_source` match is never taken, since a nearly identical headline
 * from one feed can be another story (the same disaster in another country). Every other pick
 * stays, keeping its flag.
 */
export function replaceWithNewer(
  shortlist: string[],
  chosen: ChosenStory[],
  candidates: CandidateStory[],
  sections: ReadonlyMap<string, string>,
): PreferredShortlist {
  const published = new Set(candidates.filter(c => c.status === StoryStatus.published).map(c => c.id))
  const byId = new Map(chosen.map(s => [s.id, s]))
  const taken = new Set(shortlist)
  const carriable = (newer: NewerStory, section: string) =>
    newer.reason === 'same_event' && published.has(newer.id) && sections.get(newer.id) === section && !taken.has(newer.id)
  const replaced: ShortlistReplacement[] = []
  const storyIds = shortlist.map(id => {
    const story = byId.get(id)
    const section = sections.get(id)
    const newest = story && section !== undefined ? newerStoriesOf(story, candidates).find(n => carriable(n, section)) : undefined
    if (!story || !newest) return id
    taken.add(newest.id)
    replaced.push({ replacedId: id, replacedTitle: story.title || story.sourceTitle, newerId: newest.id, newerTitle: newest.title, reason: newest.reason })
    return newest.id
  })
  return { storyIds, replaced }
}

/** Every newer story of one chosen story among the candidates, newest first; one found both ways counts once, as the same event. */
function newerStoriesOf(story: ChosenStory, candidates: CandidateStory[]): NewerStory[] {
  const minGapMs = config.freshness.sameEventMinGapHours * HOUR_MS
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
  return [...newer.values()].sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime())
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
