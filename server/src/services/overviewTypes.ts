/**
 * The in-memory shapes of ongoing-story overviews (`.context/overviews.md`) that the steps, the eval's
 * sandbox and the reads share: a story as linking reads it, what a story's active entry says of its
 * overview, a candidate overview as the link prompt shows it, and the judgment record a join keeps.
 * Types and the fixed lists only.
 */

export const OVERVIEW_SCOPES = ['single', 'forming', 'ongoing'] as const
export type OverviewScope = (typeof OVERVIEW_SCOPES)[number]

export const OVERVIEW_STATUSES = ['open', 'quiet', 'closing', 'closed'] as const
export type OverviewStatus = (typeof OVERVIEW_STATUSES)[number]

export const ENTRY_ROLES = ['turning_point', 'routine'] as const
export type EntryRole = (typeof ENTRY_ROLES)[number]

/** A turning point's kind: the answer keys' list. */
export const ROLE_KINDS = ['setback', 'response', 'spread', 'decision', 'escalation', 'deescalation', 'money', 'science', 'people', 'milestone'] as const
export type RoleKind = (typeof ROLE_KINDS)[number]

/** An entry's role and, for a turning point, its kind (null for a routine entry). */
export interface Role {
  role: EntryRole
  roleKind: RoleKind | null
}

/** The answer keys' charter: what the development is, what stays separate, and the event that ends it. */
export interface Charter {
  in: string
  out: string[]
  endEvent: string
}

/** A story as linking reads it. `date` is its publication day, `YYYY-MM-DD` (UTC); `facts` are up to 10 usable pool facts' statements, as context. */
export interface LinkStory {
  id: string
  title: string
  label: string
  summary: string
  datePublished: Date
  date: string
  issueId: string | null
  facts: string[]
}

/** What a story's active entry says of its overview, as candidates are grouped. */
export interface Membership {
  overviewId: string
  scope: OverviewScope
  status: OverviewStatus
  /** end_event, faded or editor; null unless closed. */
  closedReason: string | null
  frozen: boolean
  /** The newest active entry's publication date. */
  lastEntryAt: Date | null
}

/** Every membership the candidate grouping needs: each story's active entry, and the overviews an editor detached the story from (`locked`), which automation never links it to again. */
export interface Memberships {
  active: ReadonlyMap<string, Membership>
  lockedOut: ReadonlyMap<string, readonly string[]>
}

/** A candidate overview as the link prompt shows it: its title, charter and newest entries. */
export interface CandidateOverview {
  id: string
  title: string
  charter: Charter
  /** Its 5 newest active entries, newest first: title and publication day. */
  entries: { title: string; date: string }[]
}

/** One shared field of a join: the words of each side that state it. `other` is the overview's (its title or charter) or the founding partner's. */
export interface QuotePair {
  story: string
  other: string
}

/** The judgment record of a join or a founding: the shared cause, place and end, each quoting both sides. */
export interface Shared {
  cause: QuotePair
  place: QuotePair
  end: QuotePair
}

/** A link decision's outcome. Joined, founded, none and rejected settle the story; held, conflict and failed leave it for the next run. */
export const LINK_OUTCOMES = ['joined', 'founded', 'none', 'rejected', 'held', 'conflict', 'failed'] as const
export type LinkOutcome = (typeof LINK_OUTCOMES)[number]

export const SETTLING_OUTCOMES: readonly LinkOutcome[] = ['joined', 'founded', 'none', 'rejected']

/** A founding attempt's outcome: founded on agreement; disagreed (the check did not agree), refused (no end event named), failed (a call failed). */
export type FoundingOutcome = 'founded' | 'disagreed' | 'refused' | 'failed'

/** A "Where this stands" sentence or a "What's being done" line as stored: its text and the pool facts it cites, by row id. */
export interface StandsLine {
  text: string
  facts: string[]
}

/** Why a review runs: an entry count reached, its 30 days, a closure waiting on it, a burst of joins; the monthly audit reviews and never acts. */
export const REVIEW_TRIGGERS = ['entries', 'periodic', 'closure', 'burst', 'audit'] as const
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number]

/** An overview as the status machine, the anomaly check and the review triggers read it (`overviewStatus.ts`). */
export interface OverviewState {
  id: string
  scope: OverviewScope
  status: OverviewStatus
  closedReason: string | null
  frozen: boolean
  hidden: boolean
  /** The newest active entry's publication date. */
  lastEntryAt: Date | null
  /** The publication date of the story that reported the end event, while closing. */
  closingSince: Date | null
  /** While closing, the story whose end-event report began it (the newest live `closing` decision's); null otherwise. */
  closingStoryId: string | null
  /** Active entries whose story is published. */
  activeEntries: number
  /** Active entries whose story is no longer published: the job detaches them, frozen or not. */
  unpublished: { entryId: string; storyId: string }[]
  /** Active entries the last review kept (0 before the first), and when it ran. */
  entriesAtLastReview: number
  reviewedAt: Date | null
  /**
   * The most stories of one publication day the pipeline joined to it in the last `nightHours`, counting
   * only joins after its last freeze or review, so joins a freeze already answered never freeze it again.
   */
  burstJoins: number
  /** When a burst froze it, while no review has run since. */
  burstAt: Date | null
  /** A review with the trigger `closure` ran after its closing began. */
  closureReviewed: boolean
  /**
   * When a person last reopened it (an editor's reopen, or an undone closure), while that decision
   * stands: quiet and fading count from then when it is later than the last entry, so a reopen is not
   * closed again by the next run.
   */
  reopenedAt: Date | null
}
