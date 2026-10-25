/**
 * Every move of a newsletter issue: whether and how its state may change (ADR-0048,
 * `.context/newsletter-podcast.md` "Issue lifecycle"). This module is the only code that writes an
 * issue's lifecycle fields (`status`, `published_at`, `content`, `html`, `selected_story_ids`),
 * deletes an issue, or writes `newsletter_sends` rows, held by `test/newsletterWriters.test.ts`.
 * `newsletter.ts` builds what the moves write (shortlist, markdown, HTML) and writes nothing of it.
 *
 * - Every write move runs in a transaction that first locks the issue's row
 *   (`SELECT ... FOR UPDATE`), re-checks its rule, then writes, so moves on one issue serialize.
 *   The model-backed moves (select, generate) check before the model call too, so a refused issue
 *   spends nothing, and again at the write, so an issue sent meanwhile is not overwritten.
 * - **Frozen**: an unconfirmed live send exists, or a live non-failed send exists and the issue is
 *   published. A frozen issue refuses every build move and edit; unpublishing a sent issue opens it
 *   again, and it can never be emailed again.
 * - A live send claims its row (`status: draft`) under the lock before Plunk is called, so a second
 *   send is refused however it is started. A failure that proves nothing went out marks the row
 *   `failed`; any other leaves it `draft` ("unconfirmed"), which blocks the issue until an editor
 *   checks Plunk and marks it not sent (`markSendFailed`). Nobody gets the email twice.
 */
import type { ContentStatus, Newsletter, NewsletterSend, Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { isConnectionNotEstablished } from '../lib/retry.js'
import { BadRequestError, ConflictError, NotFoundError, summarizeError } from '../utils/errors.js'
import * as plunk from './plunk.js'
import { ensureNewsletterSlug, newsletterIssueUrl } from './newsletterArchive.js'
import { buildContent, pickShortlist, recentStoryIds, renderHtml } from './newsletter.js'

const log = createLogger('newsletter-lifecycle')

type Tx = Prisma.TransactionClient

// ──── Refusals ──────────────────────────────────────────────────────────

/** Which rule refused a move; the publish_newsletter job maps them to its notices. */
export type RefusalCode = 'frozen' | 'already_sent' | 'no_current_test' | 'sent_issue' | 'not_unconfirmed'

/** A move the issue's state does not allow (409, `{ error }`). */
export class NewsletterRefusedError extends ConflictError {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(message)
  }
}

/** A test send was refused because no test segment is configured (never falls back to all subscribers). */
export class TestSegmentNotConfiguredError extends ConflictError {
  constructor() {
    super('Test send refused: PLUNK_TEST_SEGMENT_ID is not set, and a test email is never sent to all subscribers')
  }
}

const NO_HTML = 'No HTML content — generate HTML first'
const UNCONFIRMED_REFUSAL = 'A live send of this issue is unconfirmed. Check the campaign in Plunk, then mark the send as not sent if it was not'
/** Stored on a send whose outcome Plunk left unknown. */
const UNCONFIRMED_SEND = 'Plunk may have accepted this send; check the campaign in Plunk, then mark it not sent if it was not'

// ──── The frozen rule ───────────────────────────────────────────────────

/** A live send that counts as sent (or possibly sent): not a test, not failed. */
const LIVE_SEND = { isTest: false, status: { not: 'failed' } } as const satisfies Prisma.NewsletterSendWhereInput

export interface SendState {
  /** A live non-failed send exists (confirmed or not). */
  liveSent: boolean
  /** A live send is unconfirmed: claimed, and Plunk may or may not have sent it. */
  unconfirmed: boolean
}

async function sendState(db: Tx, newsletterId: string): Promise<SendState> {
  const sends = await db.newsletterSend.findMany({ where: { newsletterId, ...LIVE_SEND }, select: { status: true } })
  return { liveSent: sends.length > 0, unconfirmed: sends.some(s => s.status === 'draft') }
}

/** Frozen: an unconfirmed live send exists, or the issue went out and is published. */
export function isFrozen(status: ContentStatus, sends: SendState): boolean {
  return sends.unconfirmed || (sends.liveSent && status === 'published')
}

async function assertNotFrozen(db: Tx, newsletter: Newsletter): Promise<void> {
  const sends = await sendState(db, newsletter.id)
  if (!isFrozen(newsletter.status, sends)) return
  throw new NewsletterRefusedError(
    'frozen',
    sends.unconfirmed ? UNCONFIRMED_REFUSAL : 'This issue was sent to subscribers. Unpublish it to edit it; it cannot be sent again',
  )
}

// ──── Locking ───────────────────────────────────────────────────────────

/** Lock the issue's row for the rest of the transaction and read it (404 when there is none). */
async function lockIssue(tx: Tx, id: string): Promise<Newsletter> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM newsletters WHERE id = ${id} FOR UPDATE`
  if (locked.length === 0) throw new NotFoundError('Newsletter not found')
  return tx.newsletter.findUniqueOrThrow({ where: { id } })
}

/** Run `move` in a transaction holding the issue's row lock. */
function underLock<T>(id: string, move: (tx: Tx, newsletter: Newsletter) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => move(tx, await lockIssue(tx, id)), { timeout: config.database.transactionTimeoutMs })
}

/** Read without a lock, for the checks before work done outside a transaction (a model call, a slug). */
async function readIssue(id: string): Promise<Newsletter> {
  const newsletter = await prisma.newsletter.findUnique({ where: { id } })
  if (!newsletter) throw new NotFoundError('Newsletter not found')
  return newsletter
}

// ──── Build moves ───────────────────────────────────────────────────────

/** assign: the longlist, the stories published in the last `storyAssignmentDays` days. */
export async function assignStories(id: string): Promise<Newsletter> {
  return underLock(id, async (tx, newsletter) => {
    await assertNotFrozen(tx, newsletter)
    const storyIds = await recentStoryIds()
    return tx.newsletter.update({ where: { id }, data: { storyIds } })
  })
}

/** select: the shortlist, picked by the model from the longlist. */
export async function selectStories(id: string): Promise<Newsletter> {
  const newsletter = await readIssue(id)
  await assertNotFrozen(prisma, newsletter)
  if (newsletter.storyIds.length === 0) throw new BadRequestError('No stories in longlist')
  const selectedStoryIds = await pickShortlist(newsletter)
  return underLock(id, async (tx, current) => {
    await assertNotFrozen(tx, current)
    return tx.newsletter.update({ where: { id }, data: { selectedStoryIds } })
  })
}

/** generate: the issue's markdown from its shortlist. */
export async function generateContent(id: string): Promise<Newsletter> {
  const newsletter = await readIssue(id)
  await assertNotFrozen(prisma, newsletter)
  if (newsletter.selectedStoryIds.length === 0) throw new BadRequestError('No stories selected')
  const content = await buildContent(newsletter)
  return underLock(id, async (tx, current) => {
    await assertNotFrozen(tx, current)
    return tx.newsletter.update({ where: { id }, data: { content } })
  })
}

/** html: the email, rendered from the content; assigns the slug its "View in browser" link needs. */
export async function generateHtml(id: string): Promise<string> {
  const newsletter = await readIssue(id)
  await assertNotFrozen(prisma, newsletter)
  if (!newsletter.content) throw new BadRequestError('No content to convert')
  // Before the lock: ensureNewsletterSlug writes the row through its own connection
  const webUrl = newsletterIssueUrl(await ensureNewsletterSlug(newsletter))
  return underLock(id, async (tx, current) => {
    await assertNotFrozen(tx, current)
    if (!current.content) throw new BadRequestError('No content to convert')
    const html = renderHtml(current, webUrl)
    await tx.newsletter.update({ where: { id }, data: { html } })
    return html
  })
}

/** The fields `PUT /:id` edits by hand. */
export interface NewsletterEdit {
  title?: string
  content?: string
  html?: string
  storyIds?: string[]
  selectedStoryIds?: string[]
}

/** edit: a person's changes. An edit with no fields changes nothing and is never refused. */
export async function editNewsletter(id: string, edit: NewsletterEdit): Promise<Newsletter> {
  return underLock(id, async (tx, newsletter) => {
    if (Object.values(edit).every(value => value === undefined)) return newsletter
    await assertNotFrozen(tx, newsletter)
    return tx.newsletter.update({ where: { id }, data: edit })
  })
}

// ──── Publication ───────────────────────────────────────────────────────

/**
 * When an issue first went out: its earliest live (non-test, not failed) send, by `sentAt`, or
 * `createdAt` for a scheduled send, which records no time of its own. Null if it was never sent.
 */
async function firstLiveSendDate(tx: Tx, newsletterId: string): Promise<Date | null> {
  const sends = await tx.newsletterSend.findMany({ where: { newsletterId, ...LIVE_SEND }, select: { sentAt: true, createdAt: true } })
  const dates = sends.map(send => (send.sentAt ?? send.createdAt).getTime())
  return dates.length > 0 ? new Date(Math.min(...dates)) : null
}

/**
 * The publish write, under the issue's lock: `published`, and `publishedAt` the first time, which
 * is the date the issue was first emailed if it was (so an older issue published on the web later
 * keeps its own week), else now. Its slug is assigned before the lock.
 */
async function publishLocked(tx: Tx, newsletter: Newsletter): Promise<Newsletter> {
  if (newsletter.status === 'published') return newsletter
  const publishedAt = newsletter.publishedAt ?? (await firstLiveSendDate(tx, newsletter.id)) ?? new Date()
  return tx.newsletter.update({ where: { id: newsletter.id }, data: { status: 'published', publishedAt } })
}

/** publish: the issue goes public on the web (ADR-0041). A no-op when it already is. */
export async function publishNewsletter(id: string): Promise<Newsletter> {
  const newsletter = await readIssue(id)
  if (newsletter.status === 'published') return newsletter
  const slug = await ensureNewsletterSlug(newsletter)
  const published = await underLock(id, publishLocked)
  log.info({ newsletterId: id, slug }, 'newsletter published on the web')
  return published
}

/** unpublish: off the web; slug, `publishedAt` and sends stay. Opens a sent issue for editing again. */
export async function unpublishNewsletter(id: string): Promise<Newsletter> {
  return underLock(id, async (tx, newsletter) => {
    if (newsletter.status === 'draft') return newsletter
    return tx.newsletter.update({ where: { id }, data: { status: 'draft' } })
  })
}

/** delete: refused once the issue was sent (its sends are the record the weekly guard reads). */
export async function deleteNewsletter(id: string): Promise<void> {
  await underLock(id, async tx => {
    if ((await sendState(tx, id)).liveSent) {
      throw new NewsletterRefusedError('sent_issue', 'This issue was sent to subscribers, so it cannot be deleted. Unpublish it to take it off the website')
    }
    await tx.newsletter.delete({ where: { id } })
  })
}

// ──── Sends ─────────────────────────────────────────────────────────────

/**
 * sendTest: the email to the test segment only, in any state (it changes nothing the public
 * sees). Its row is written after Plunk accepted the send, so a row means the test went out; a
 * `sent` test row whose HTML is the issue's current HTML is what unlocks the live send.
 */
export async function sendTest(id: string): Promise<NewsletterSend> {
  const segmentId = config.plunk.testSegmentId
  if (!segmentId) {
    const err = new TestSegmentNotConfiguredError()
    log.error({ newsletterId: id }, err.message)
    throw err
  }

  const newsletter = await readIssue(id)
  if (!newsletter.html) throw new BadRequestError(NO_HTML)
  const html = newsletter.html

  log.info({ newsletterId: id }, 'creating test campaign in Plunk')
  const campaign = await plunk.createCampaign({
    name: `[TEST] ${newsletter.title}`,
    subject: `[TEST] ${newsletter.title}`,
    body: html,
    audienceType: 'SEGMENT',
    segmentId,
  })
  await plunk.sendCampaign(campaign.id)

  return prisma.newsletterSend.create({
    data: { newsletterId: id, plunkCampaignId: campaign.id, isTest: true, status: 'sent', htmlContent: html, sentAt: new Date() },
  })
}

/** Under the lock: refuse a second live send or one without a current test, else claim the row. */
async function claimLiveSend(tx: Tx, newsletter: Newsletter): Promise<NewsletterSend> {
  if (!newsletter.html) throw new BadRequestError(NO_HTML)
  const sends = await sendState(tx, newsletter.id)
  if (sends.liveSent) {
    throw new NewsletterRefusedError(
      'already_sent',
      sends.unconfirmed ? UNCONFIRMED_REFUSAL : 'This issue was already sent to subscribers; it cannot be sent again',
    )
  }
  const currentTest = await tx.newsletterSend.findFirst({
    where: { newsletterId: newsletter.id, isTest: true, status: 'sent', htmlContent: newsletter.html },
    select: { id: true },
  })
  if (!currentTest) throw new NewsletterRefusedError('no_current_test', 'Send a test email of the current HTML first')
  return tx.newsletterSend.create({ data: { newsletterId: newsletter.id, isTest: false, status: 'draft', htmlContent: newsletter.html } })
}

/** True when a failed Plunk call certainly sent nothing: no connection was made, or Plunk refused the request (4xx). */
function provedNotSent(err: unknown): boolean {
  if (isConnectionNotEstablished(err)) return true
  const status = (err as { response?: { status?: unknown } } | null)?.response?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

/** Record what a failed Plunk call means for the claimed row. A failure to record leaves it unconfirmed (blocked). */
async function recordSendFailure(sendId: string, err: unknown, sentNothing: boolean): Promise<void> {
  const data = sentNothing ? { status: 'failed' as const, errorMessage: summarizeError(err) } : { errorMessage: `${UNCONFIRMED_SEND} (${summarizeError(err)})` }
  await prisma.newsletterSend.update({ where: { id: sendId }, data }).catch(dbErr => log.error({ sendId, err: dbErr }, 'could not record the send failure'))
  if (!sentNothing) log.error({ sendId, err }, 'live send outcome unknown: the send stays unconfirmed until an editor checks Plunk')
}

/**
 * sendLive: the email to all subscribers, then the issue is published (also for a scheduled send,
 * at once). Refused with a live non-failed send (`already_sent`) or without a `sent` test of the
 * current HTML (`no_current_test`).
 *
 * 1. Claim a `draft` live row under the lock: a second caller waits for the lock, then is refused.
 * 2. Create the campaign and store its id on the row; a failure here sent nothing (`failed`).
 * 3. Send it. A failure that proves nothing went out marks the row `failed`; any other (timeout,
 *    reset, 5xx: Plunk may have accepted it) leaves it `draft`, unconfirmed.
 * 4. Confirm (`sending` with `sentAt`, or `scheduled`) and publish in one transaction. If this
 *    fails, or the process dies after step 1, the row stays `draft`: blocked, never resent.
 */
export async function sendLive(id: string, scheduledFor?: string): Promise<NewsletterSend> {
  const newsletter = await readIssue(id)
  if (!newsletter.html) throw new BadRequestError(NO_HTML)
  // Before the claim (and outside the lock: it writes through its own connection), so publishing
  // after Plunk accepted the send has nothing left that can fail on the slug
  await ensureNewsletterSlug(newsletter)

  const claim = await underLock(id, claimLiveSend)
  log.info({ newsletterId: id, sendId: claim.id, scheduledFor }, 'live send claimed, creating campaign in Plunk')

  let campaignId: string
  try {
    campaignId = (await plunk.createCampaign({ name: newsletter.title, subject: newsletter.title, body: claim.htmlContent, audienceType: 'ALL' })).id
  } catch (err) {
    await recordSendFailure(claim.id, err, true)
    throw err
  }
  await prisma.newsletterSend.update({ where: { id: claim.id }, data: { plunkCampaignId: campaignId } })

  try {
    await plunk.sendCampaign(campaignId, scheduledFor)
  } catch (err) {
    await recordSendFailure(claim.id, err, provedNotSent(err))
    throw err
  }

  const confirmed = await underLock(id, async (tx, current) => {
    const send = await tx.newsletterSend.update({
      where: { id: claim.id },
      data: scheduledFor ? { status: 'scheduled' } : { status: 'sending', sentAt: new Date() },
    })
    await publishLocked(tx, current)
    return send
  })
  log.info({ newsletterId: id, sendId: claim.id }, 'newsletter sent to all subscribers and published')
  return confirmed
}

/**
 * markSendFailed: an editor checked Plunk and found an unconfirmed live send did not go out. The
 * row becomes `failed`, which releases the issue for another send.
 */
export async function markSendFailed(id: string, sendId: string): Promise<NewsletterSend> {
  return underLock(id, async tx => {
    const send = await tx.newsletterSend.findFirst({ where: { id: sendId, newsletterId: id } })
    if (!send) throw new NotFoundError('Send not found')
    if (send.isTest || send.status !== 'draft') {
      throw new NewsletterRefusedError('not_unconfirmed', 'Only an unconfirmed live send can be marked as not sent')
    }
    log.warn({ newsletterId: id, sendId }, 'unconfirmed live send marked as not sent by an editor')
    return tx.newsletterSend.update({ where: { id: sendId }, data: { status: 'failed', errorMessage: 'Marked as not sent by an editor after checking Plunk' } })
  })
}
