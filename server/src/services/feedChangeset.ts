/**
 * Preview and apply a feed changeset (`.context/feed-management.md`, "Changesets"). Both resolve it
 * with `planChangeset()`; apply writes only when no change has an error, every write in one
 * transaction, so a changeset lands whole or not at all.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { ServiceError } from '../utils/errors.js'
import type { FeedChangeset } from '../schemas/feedChangeset.js'
import { createFeed, deleteFeed, updateFeed } from './feed.js'
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
  const results = await prisma.$transaction(
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
      for (const change of planned) applied.push(await applyOne(change, tx))
      return applied
    },
    { timeout: config.database.transactionTimeoutMs },
  )
  const report = toReport(changeset, results)
  log.info({ title: report.title, ...report.counts }, 'feed changeset applied')
  return { applied: true, ...report }
}

async function applyOne({ result, write }: PlannedChange, tx: Prisma.TransactionClient): Promise<FeedChangeResult> {
  if (!write) return result
  return { ...result, message: await perform(write, tx) }
}

/** Perform one write through the feed service, as the single-feed endpoints do; returns what it did. */
async function perform(write: FeedWrite, tx: Prisma.TransactionClient): Promise<string> {
  switch (write.kind) {
    case 'create':
      await createFeed(write.data, tx)
      return 'Created'
    case 'update': {
      await updateFeed(write.feedId, write.data, tx)
      const fields = Object.keys(write.data).length
      return `Updated ${fields} field${fields === 1 ? '' : 's'}`
    }
    case 'delete': {
      // deleteFeed counts the stories again inside the transaction: one may have arrived since the preview.
      const { action } = await deleteFeed(write.feedId, tx)
      return action === 'deleted' ? 'Deleted' : 'Deactivated (it has stories)'
    }
  }
}
