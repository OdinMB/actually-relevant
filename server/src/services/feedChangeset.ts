/**
 * Preview and apply a feed changeset (`.context/feed-management.md`, "Changesets"). Both resolve it
 * with `planChangeset()`; apply writes only when no change has an error, every write in one
 * transaction, so a changeset lands whole or not at all. Once it has committed, the favicons of the
 * feeds it created or readdressed are fetched in the background.
 */
import type { Feed, Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { ServiceError } from '../utils/errors.js'
import type { FeedChangeset } from '../schemas/feedChangeset.js'
import { createFeed, deleteFeed, updateFeed } from './feed.js'
import { fetchFaviconsInBackground, setsFaviconSource } from './favicon.js'
import {
  countResults,
  planChangeset,
  type ChangesetSnapshot,
  type FeedChangeResult,
  type FeedChangeStatus,
  type FeedWrite,
  type PlannedChange,
} from './feedChangesetPlan.js'

const log = createLogger('feedChangeset')

export interface FeedChangesetReport {
  title: string | null
  results: FeedChangeResult[]
  counts: Record<FeedChangeStatus, number>
}

/** 400: the changeset has changes with errors, so apply wrote nothing. The body carries the preview. */
export class ChangesetHasErrorsError extends ServiceError {
  constructor(readonly report: FeedChangesetReport) {
    const { error } = report.counts
    super(`${error} of ${report.results.length} changes ${error === 1 ? 'has an error' : 'have errors'}; nothing was applied`, 400)
  }

  override toBody(): Record<string, unknown> {
    return { error: this.message, applied: false, ...this.report }
  }
}

async function loadSnapshot(db: Prisma.TransactionClient): Promise<ChangesetSnapshot> {
  const feeds = await db.feed.findMany({
    select: {
      id: true,
      title: true,
      rssUrl: true,
      url: true,
      displayTitle: true,
      language: true,
      region: true,
      issueId: true,
      crawlIntervalHours: true,
      htmlSelector: true,
      paywallDetection: true,
      paywallTitleMarker: true,
      contentSource: true,
      active: true,
      _count: { select: { stories: true } },
    },
  })
  const issues = await db.issue.findMany({ select: { id: true, slug: true } })
  return { feeds: feeds.map(({ _count, ...feed }) => ({ ...feed, storyCount: _count.stories })), issues }
}

function toReport(changeset: FeedChangeset, results: FeedChangeResult[]): FeedChangesetReport {
  return { title: changeset.title ?? null, results, counts: countResults(results) }
}

/** Resolve every change against the current feeds and issues; writes nothing. */
export async function previewChangeset(changeset: FeedChangeset): Promise<FeedChangesetReport> {
  const planned = planChangeset(changeset.changes, await loadSnapshot(prisma))
  return toReport(
    changeset,
    planned.map(change => change.result),
  )
}

/**
 * Resolve the changeset again, against the feeds as they are now rather than at the preview, and
 * apply it in one transaction when no change has an error; otherwise throw
 * `ChangesetHasErrorsError` with the new preview and write nothing. A write the database refuses
 * (a unique RSS URL taken meanwhile) rolls the whole changeset back.
 */
export async function applyChangeset(changeset: FeedChangeset): Promise<FeedChangesetReport & { applied: true }> {
  const { results, needFavicon } = await prisma.$transaction(
    async tx => {
      const planned = planChangeset(changeset.changes, await loadSnapshot(tx))
      if (planned.some(change => change.result.status === 'error')) {
        throw new ChangesetHasErrorsError(
          toReport(
            changeset,
            planned.map(change => change.result),
          ),
        )
      }
      const applied: FeedChangeResult[] = []
      const needFavicon: Feed[] = []
      for (const change of planned) {
        const { result, faviconFor } = await applyOne(change, tx)
        applied.push(result)
        if (faviconFor) needFavicon.push(faviconFor)
      }
      return { results: applied, needFavicon }
    },
    { timeout: config.database.transactionTimeoutMs },
  )
  // After the commit, so each favicon's row can reference its feed
  if (needFavicon.length > 0) void fetchFaviconsInBackground(needFavicon)
  const report = toReport(changeset, results)
  log.info({ title: report.title, ...report.counts }, 'feed changeset applied')
  return { applied: true, ...report }
}

/** Apply one planned change; `faviconFor` is the feed written when it was created or given a new address. */
async function applyOne({ result, write }: PlannedChange, tx: Prisma.TransactionClient): Promise<{ result: FeedChangeResult; faviconFor?: Feed }> {
  if (!write) return { result }
  const { message, feed } = await perform(write, tx)
  const readdressed = write.kind === 'create' || (write.kind === 'update' && setsFaviconSource(write.data))
  return { result: { ...result, message }, faviconFor: readdressed ? feed : undefined }
}

/** Perform one write through the feed service, as the single-feed endpoints do; returns what it did and the feed written. */
async function perform(write: FeedWrite, tx: Prisma.TransactionClient): Promise<{ message: string; feed?: Feed }> {
  switch (write.kind) {
    case 'create':
      return { message: 'Created', feed: await createFeed(write.data, tx) }
    case 'update': {
      const feed = await updateFeed(write.feedId, write.data, tx)
      const fields = Object.keys(write.data).length
      return { message: `Updated ${fields} field${fields === 1 ? '' : 's'}`, feed }
    }
    case 'delete': {
      // deleteFeed counts the stories again inside the transaction: one may have arrived since the preview.
      const { action } = await deleteFeed(write.feedId, tx)
      return { message: action === 'deleted' ? 'Deleted' : 'Deactivated (it has stories)' }
    }
  }
}
