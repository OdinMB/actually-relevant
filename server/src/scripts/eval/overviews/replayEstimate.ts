/**
 * The whole-step replay's desk estimate for the dry run (`replay.ts`), from the keys alone, with no
 * database read and no call: the stories it links (the half's and, in a judged run, the background's,
 * as `linkReplayStories` gives them) in date order by the keys' own dates, cut by `--limit`; the
 * reviews each development would be due by production's own schedule (`overviewStatus.ts`) if it were
 * one overview, the background's as any other, since none is skipped; and what that costs at the
 * 2026-11-24 paid run's prices (`REPLAY_DESK`). Pure.
 */
import { config } from '../../../config.js'
import { anomalies, nextState, reviewDue, scopeAfterReview, type StatusOptions } from '../../../services/overviewStatus.js'
import type { OverviewState } from '../../../services/overviewTypes.js'
import type { AnswerKey } from './keySchema.js'
import type { ReplayStorySet } from './link.js'
import { addDays, lastReplayDay } from './replay.js'
import { usd } from './reportText.js'

/**
 * The prices of the 2026-11-24 paid replay of the judged half alone (201 stories, 7 overviews, 32
 * reviews, $1.27). In the folder's ledger: 171 link calls $0.058, 14 founding drafts $0.091 and 14
 * checks $0.060, 32 reviews $0.706 ranging $0.006 to $0.045 with the entries read, one re-center
 * attempt $0.051, the stands and their checks about $0.30.
 */
export const REPLAY_DESK = {
  /** The link calls and the foundings, per story replayed. */
  linkUsdPerStory: 0.001,
  /** A review: its base, and each entry it reads. */
  reviewUsd: 0.006,
  reviewUsdPerEntry: 0.00085,
  /** The stands and their checks in a run: only the half's researched members have facts to write them from. */
  standsUsdPerRun: 0.3,
  recenterAttemptUsd: 0.05,
}

/**
 * The reviews one development is due if it is one overview whose entries join on their days (each
 * counted from its day's start): founded on its second entry's day, then each night to `end` the
 * status machine's moves and the review due by production's own rules, every entry kept. So a review
 * each time the entries reach a count of `reviewAt`, one on a night when more of that day's stories join
 * than `burstLimit` (the burst's own review, taken to lift the freeze), and one every `reviewEveryDays`
 * while it is public and not closed: a faded one gets none until a late entry reopens it. Each with the
 * entries it reads.
 */
export function expectedReviews(days: readonly string[], end: string, options: StatusOptions = config.overviews): { day: string; entries: number }[] {
  const sorted = [...days].sort()
  if (sorted.length < 2) return []
  // Neutral where the keys say nothing: no reader's report, no editor's re-center, no freeze left standing, every member published
  let state: OverviewState = {
    id: 'estimate',
    title: '',
    scope: 'single',
    status: 'open',
    closedReason: null,
    frozen: false,
    hidden: false,
    lastEntryAt: null,
    activeEntries: 0,
    unpublished: [],
    entriesAtLastReview: 0,
    reviewedAt: null,
    burstJoins: 0,
    burstAt: null,
    reopenedAt: null,
    reportAt: null,
    recenteredAt: null,
    recenteredBy: null,
  }
  const reviews: { day: string; entries: number }[] = []
  for (let day = sorted[1]!; day <= end; day = addDays(day, 1)) {
    const joined = sorted.filter(d => d <= day)
    const night = new Date(`${day}T23:59:59Z`)
    // A replayed night links the stories of its own day, so those are the joins a burst counts
    state = {
      ...state,
      activeEntries: joined.length,
      lastEntryAt: new Date(`${joined.at(-1)!}T00:00:00Z`),
      burstJoins: joined.filter(d => d === day).length,
    }
    for (const m of nextState(state, night, options)) {
      if (m.kind === 'scope') state = { ...state, scope: m.to }
      if (m.kind === 'status') state = { ...state, status: m.to, closedReason: m.to === 'closed' ? m.reason : null }
    }
    // A burst freezes the overview and queues its review for the same night; the estimate takes that review to lift the freeze
    if (anomalies(state, options).includes('burst')) state = { ...state, burstAt: night }
    if (!reviewDue(state, { now: night }, options)) continue
    reviews.push({ day, entries: state.activeEntries })
    state = { ...state, scope: scopeAfterReview(state.activeEntries), reviewedAt: night, entriesAtLastReview: state.activeEntries, burstAt: null }
  }
  return reviews
}

/** What the whole-step replay would link and review, and its cost per run and in all. */
export interface ReplayEstimate {
  /** The stories replayed, after `--limit`, and those asked: the half's (entries and near misses) and the background's. */
  stories: { judged: number; background: number }
  asked: { judged: number; background: number }
  /** The last day replayed (`lastReplayDay`); null with no story. */
  end: string | null
  /** Each development, the half's keys then the background's: its base entries among the stories replayed, and the reviews they would bring. */
  developments: { key: string; background: boolean; entries: number; reviews: number; reviewsUsd: number }[]
  usdPerRun: { linking: number; reviews: number; stands: number; total: number }
  repeat: number
  totalUsd: number
}

/** What the whole-step replay of a story set (`linkReplayStories`) would link and review, and what that costs at the desk prices. */
export function estimateReplay(set: Pick<ReplayStorySet, 'keys' | 'slugs' | 'asked' | 'background'>, o: { repeat: number; limit?: number }): ReplayEstimate {
  const dateOf = new Map<string, string>()
  const dated = (items: readonly { slug: string; date: string }[]) => {
    for (const x of items) if (!dateOf.has(x.slug)) dateOf.set(x.slug, x.date)
  }
  for (const k of set.keys) dated([...k.entries, ...k.nearMisses, ...k.centers.flatMap(c => [...c.entries, ...c.nearMisses])])
  for (const k of set.background.keys) dated(k.entries)
  // One date order across the half and the background, as the replay links them (a tie keeps the order asked)
  const ordered = [...set.asked].sort((a, b) => (dateOf.get(a) ?? '').localeCompare(dateOf.get(b) ?? ''))
  const replayed = new Set(o.limit !== undefined ? ordered.slice(0, o.limit) : ordered)
  const lastStoryDay = [...replayed]
    .map(s => dateOf.get(s) ?? '')
    .sort()
    .at(-1)
  const end = lastStoryDay ? lastReplayDay(lastStoryDay) : null
  const development = (k: AnswerKey, background: boolean): ReplayEstimate['developments'][number] => {
    const days = k.entries.filter(e => replayed.has(e.slug)).map(e => e.date)
    const reviews = end ? expectedReviews(days, end) : []
    return {
      key: k.id,
      background,
      entries: days.length,
      reviews: reviews.length,
      reviewsUsd: reviews.reduce((s, r) => s + REPLAY_DESK.reviewUsd + r.entries * REPLAY_DESK.reviewUsdPerEntry, 0),
    }
  }
  const developments = [...set.keys.map(k => development(k, false)), ...set.background.keys.map(k => development(k, true))]
  const linking = replayed.size * REPLAY_DESK.linkUsdPerStory
  const reviews = developments.reduce((s, d) => s + d.reviewsUsd, 0)
  const stands = replayed.size > 0 ? REPLAY_DESK.standsUsdPerRun : 0
  const total = linking + reviews + stands
  const among = (slugs: readonly string[]) => slugs.filter(s => replayed.has(s)).length
  return {
    stories: { judged: among(set.slugs), background: among(set.background.slugs) },
    asked: { judged: set.slugs.length, background: set.background.slugs.length },
    end,
    developments,
    usdPerRun: { linking, reviews, stands, total },
    repeat: o.repeat,
    totalUsd: total * o.repeat,
  }
}

/** The dry run's lines for the replay: what it links, the reviews it would bring, and the estimate. */
export function replayEstimateLines(e: ReplayEstimate, half: string): string[] {
  const of = (background: boolean) => e.developments.filter(d => d.background === background)
  const background =
    e.asked.background > 0
      ? ` and ${e.asked.background} background stories of ${of(true)
          .map(d => d.key)
          .join(', ')}`
      : ''
  const reviewsOf = (background: boolean) => of(background).reduce((s, d) => s + d.reviews, 0)
  const each = e.developments.map(d => `${d.key} ${d.reviews}`).join(', ')
  const reviews =
    e.asked.background > 0
      ? `about ${reviewsOf(false)} for the half's keys and about ${reviewsOf(true)} more for the background's (${each}); none is skipped: a background overview's review sets its scope, members and charter, which the judged stories' link calls read`
      : `about ${reviewsOf(false)} for the half's keys (${each})`
  const p = e.usdPerRun
  return [
    `replay: ${e.asked.judged} stories of the half's ${of(false).length} keys (half ${half})${background}; ${e.stories.judged + e.stories.background} replayed × ${e.repeat} run(s), day by day to ${e.end ?? 'no day: nothing to replay'}`,
    `replay: reviews by production's schedule if each development were one overview: ${reviews}`,
    `replay: desk estimate about ${usd(e.totalUsd)} (a run: ${usd(p.linking)} linking at ${usd(REPLAY_DESK.linkUsdPerStory)} a story, ${usd(p.reviews)} reviews, ${usd(p.stands)} stands for the half's researched members; background stories have no researched facts and write none), at the 2026-11-24 paid run's prices; a development that splits or look-alikes that found one add reviews, a re-center attempt about ${usd(REPLAY_DESK.recenterAttemptUsd)}, and what the folder's cache answers costs nothing again`,
  ]
}
