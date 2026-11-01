/**
 * Resolves a feed changeset against the feeds and issues as they are, without writing: which feed
 * each change means, whether it is valid, what it would change, and the write that does it
 * (`.context/feed-management.md`, "Changesets"). Pure, so preview and apply resolve alike;
 * `feedChangeset.ts` loads the snapshot and performs the writes.
 *
 * Changes resolve in file order, against the feeds before the changeset, so a match never finds a
 * feed the same file creates, and a feed may be changed by one change only. RSS URLs are tracked in
 * order: a URL that an earlier change frees (an update moving away from it, a delete that removes a
 * feed without stories) may be taken by a later change.
 */
import type { FeedRegion } from '@prisma/client'
import { feedChangeSchema, type FeedChange, type FeedChangeAction, type FeedMatch } from '../schemas/feedChangeset.js'
import type { FeedChanges, NewFeed } from './feed.js'

/** A feed as the changeset sees it. */
export interface SnapshotFeed {
  id: string
  title: string
  rssUrl: string
  url: string | null
  displayTitle: string | null
  language: string
  region: FeedRegion | null
  issueId: string
  crawlIntervalHours: number
  htmlSelector: string | null
  paywallDetection: boolean
  paywallTitleMarker: string | null
  contentSource: string
  active: boolean
  storyCount: number
}

export interface ChangesetSnapshot {
  feeds: SnapshotFeed[]
  issues: { id: string; slug: string }[]
}

type FieldValue = string | number | boolean | null

/** One field an update changes, named as in the changeset (`issue` is the slug). */
export interface FieldDiff {
  field: string
  from: FieldValue
  to: FieldValue
}

export type FeedChangeStatus = 'ok' | 'noop' | 'error'

export interface FeedChangeResult {
  /** The change's position in the file's `changes`, from 0. */
  index: number
  /** Null when the change names no known action. */
  action: FeedChangeAction | null
  /** The matched feed's title, or the new feed's; null when the match found no single feed. */
  feedTitle: string | null
  reason: string | null
  status: FeedChangeStatus
  message: string
  /** Updates only: each field it changes. */
  diff?: FieldDiff[]
}

export type FeedWrite = { kind: 'create'; data: NewFeed } | { kind: 'update'; feedId: string; data: FeedChanges } | { kind: 'delete'; feedId: string }

export interface PlannedChange {
  result: FeedChangeResult
  /** The write an `ok` change applies; null for `noop` and `error`. */
  write: FeedWrite | null
}

/** What resolving one change reads, and what earlier changes have claimed. */
interface PlanState {
  feeds: SnapshotFeed[]
  issueIdBySlug: Map<string, string>
  issueSlugById: Map<string, string>
  /** RSS URL → who holds it, for messages: `feed "Title"` or `change #N`. */
  urlHolders: Map<string, string>
  /** Feed id → the 1-based number of the change that already changes it. */
  changedBy: Map<string, number>
}

export function planChangeset(changes: readonly unknown[], snapshot: ChangesetSnapshot): PlannedChange[] {
  const state: PlanState = {
    feeds: snapshot.feeds,
    issueIdBySlug: new Map(snapshot.issues.map(issue => [issue.slug, issue.id])),
    issueSlugById: new Map(snapshot.issues.map(issue => [issue.id, issue.slug])),
    urlHolders: new Map(snapshot.feeds.map(feed => [feed.rssUrl, `feed "${feed.title}"`])),
    changedBy: new Map(),
  }
  return changes.map((raw, index) => planOne(raw, index, state))
}

export function countResults(results: readonly FeedChangeResult[]): Record<FeedChangeStatus, number> {
  const counts = { ok: 0, noop: 0, error: 0 }
  for (const result of results) counts[result.status]++
  return counts
}

function planOne(raw: unknown, index: number, state: PlanState): PlannedChange {
  const parsed = feedChangeSchema.safeParse(raw)
  if (!parsed.success) {
    const message = parsed.error.issues.map(issue => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ')
    return refused({ index, action: rawAction(raw), feedTitle: null, reason: rawReason(raw) }, message)
  }
  const change = parsed.data
  switch (change.action) {
    case 'create':
      return planCreate(change, index, state)
    case 'update':
      return planUpdate(change, index, state)
    case 'delete':
      return planDelete(change, index, state)
  }
}

type ResultHead = Pick<FeedChangeResult, 'index' | 'action' | 'feedTitle' | 'reason'>

function refused(head: ResultHead, message: string): PlannedChange {
  return { result: { ...head, status: 'error', message }, write: null }
}

function planCreate(change: Extract<FeedChange, { action: 'create' }>, index: number, state: PlanState): PlannedChange {
  const { issue, ...fields } = change.feed
  const head: ResultHead = { index, action: 'create', feedTitle: fields.title, reason: change.reason }
  const issueId = state.issueIdBySlug.get(issue)
  const problems = [issueId ? null : unknownIssue(issue), urlTakenBy(fields.rssUrl, state)].filter(isProblem)
  if (problems.length > 0 || !issueId) return refused(head, problems.join('; '))

  state.urlHolders.set(fields.rssUrl, `change #${index + 1}`)
  return { result: { ...head, status: 'ok', message: 'Creates the feed' }, write: { kind: 'create', data: { ...fields, issueId } } }
}

function planUpdate(change: Extract<FeedChange, { action: 'update' }>, index: number, state: PlanState): PlannedChange {
  const found = claimFeed(change.match, index, state)
  const head: ResultHead = { index, action: 'update', feedTitle: found.feed?.title ?? null, reason: change.reason }
  if (!found.feed) return refused(head, found.problem)
  const feed = found.feed

  const { issue, ...fields } = change.set
  const data: FeedChanges = { ...fields }
  const diff: FieldDiff[] = []
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const from = feed[field] ?? null
    const to = fields[field] ?? null
    if (from === to) delete data[field]
    else diff.push({ field, from, to })
  }

  const problems = [found.problem]
  if (issue !== undefined) {
    const issueId = state.issueIdBySlug.get(issue)
    if (!issueId) problems.push(unknownIssue(issue))
    else if (issueId !== feed.issueId) {
      data.issueId = issueId
      diff.push({ field: 'issue', from: state.issueSlugById.get(feed.issueId) ?? null, to: issue })
    }
  }
  if (data.rssUrl !== undefined) problems.push(urlTakenBy(data.rssUrl, state))
  const problem = problems.filter(isProblem).join('; ')
  if (problem) return refused(head, problem)

  if (diff.length === 0) return { result: { ...head, status: 'noop', message: 'Nothing to change; the feed already has these values' }, write: null }
  if (data.rssUrl !== undefined) {
    state.urlHolders.delete(feed.rssUrl)
    state.urlHolders.set(data.rssUrl, `feed "${feed.title}"`)
  }
  return {
    result: { ...head, status: 'ok', message: `Changes ${plural(diff.length, 'field')}`, diff },
    write: { kind: 'update', feedId: feed.id, data },
  }
}

function planDelete(change: Extract<FeedChange, { action: 'delete' }>, index: number, state: PlanState): PlannedChange {
  const found = claimFeed(change.match, index, state)
  const head: ResultHead = { index, action: 'delete', feedTitle: found.feed?.title ?? null, reason: change.reason }
  if (!found.feed || found.problem) return refused(head, found.problem ?? '')
  const feed = found.feed

  // As deleteFeed(): a feed with stories is only deactivated, so its stories keep their source.
  if (feed.storyCount > 0) {
    if (!feed.active)
      return { result: { ...head, status: 'noop', message: 'Nothing to change; the feed is already inactive and keeps its stories' }, write: null }
    return {
      result: { ...head, status: 'ok', message: `Deactivates the feed (it has ${plural(feed.storyCount, 'story', 'stories')}, so it is kept)` },
      write: { kind: 'delete', feedId: feed.id },
    }
  }
  state.urlHolders.delete(feed.rssUrl)
  return { result: { ...head, status: 'ok', message: 'Deletes the feed (it has no stories)' }, write: { kind: 'delete', feedId: feed.id } }
}

/**
 * The single feed a match names, marked as changed by this change. `problem` is set when there is
 * none or several (then `feed` is undefined), or when an earlier change already changes the feed.
 */
function claimFeed(match: FeedMatch, index: number, state: PlanState): { feed: SnapshotFeed; problem: string | null } | { feed?: undefined; problem: string } {
  const matches = state.feeds.filter(
    feed =>
      (match.id !== undefined && feed.id === match.id) ||
      (match.rssUrl !== undefined && feed.rssUrl === match.rssUrl) ||
      (match.title !== undefined && feed.title === match.title),
  )
  const [feed] = matches
  if (!feed) return { problem: noMatch(match) }
  if (matches.length > 1) return { problem: `${matches.length} feeds are titled "${match.title}"; match by id or rssUrl instead` }

  const earlier = state.changedBy.get(feed.id)
  if (earlier !== undefined) return { feed, problem: `This feed is already changed by change #${earlier}; put both in one change` }
  state.changedBy.set(feed.id, index + 1)
  return { feed, problem: null }
}

function noMatch(match: FeedMatch): string {
  if (match.id !== undefined) return `No feed has id ${match.id}`
  if (match.rssUrl !== undefined) return `No feed has rssUrl ${match.rssUrl}`
  return `No feed is titled "${match.title}" (exact and case-sensitive)`
}

function urlTakenBy(rssUrl: string, state: PlanState): string | null {
  const holder = state.urlHolders.get(rssUrl)
  return holder ? `rssUrl ${rssUrl} is already used by ${holder}` : null
}

function unknownIssue(slug: string): string {
  return `Unknown issue "${slug}"`
}

function isProblem(problem: string | null): problem is string {
  return problem !== null
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function rawAction(raw: unknown): FeedChangeAction | null {
  const action = (raw as { action?: unknown } | null)?.action
  return action === 'create' || action === 'update' || action === 'delete' ? action : null
}

function rawReason(raw: unknown): string | null {
  const reason = (raw as { reason?: unknown } | null)?.reason
  return typeof reason === 'string' ? reason : null
}
