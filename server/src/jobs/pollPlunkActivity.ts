/**
 * The poll_plunk_activity job (ADR-0029, `.context/admin-notices.md`): turn Plunk spam complaints and
 * permanent bounces into admin notices, without personal data. Every run reads the trailing
 * `activityLookbackDays`, whatever earlier runs saw, and records each activity once by its id
 * (insert-only), so a missed run, a disabled week or a late event is caught by the next run and a
 * seen notice is never reopened. A failure throws, so the scheduler records it as a job failure.
 */
import { config } from '../config.js'
import { createLogger } from '../lib/logger.js'
import { notify } from '../lib/notify.js'
import { listActivity, type PlunkActivity, type PlunkActivityType } from '../services/plunk.js'
import type { NoticeInput } from '../services/adminNotices.js'

const log = createLogger('poll_plunk_activity')

const TYPES: PlunkActivityType[] = ['email.complaint', 'email.bounced']
const DAY_MS = 24 * 60 * 60 * 1000

const COMPLAINT_STAKES =
  'One more complaint before about 5,800 total sends disables the Plunk project; see DOCS/2026-10-08_plunk-suspension-review.md.'

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * Which email it was: the campaign's name, or "transactional: <subject>". Reads only `campaignName`,
 * `subject` and `sourceType`; never the address, the contact id, the body or a bounce's error text,
 * any of which can name the recipient.
 */
function describeEmail(metadata: unknown): string {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>
  const campaign = text(m.campaignName)
  if (campaign) return `campaign "${campaign}"`
  const subject = text(m.subject)
  const kind = text(m.sourceType)?.toLowerCase() ?? 'transactional'
  return subject ? `${kind}: "${subject}"` : kind
}

/** The notice for one activity item, or null for a type this job does not ask for. Throws for an item without an id. */
export function activityNotice(activity: PlunkActivity): NoticeInput | null {
  const id = text(activity.id)
  if (!id) throw new Error('Plunk activity item without an id: cannot record it once')
  const when = text(activity.timestamp) ?? 'an unknown time'
  const what = describeEmail(activity.metadata)
  const shared = { source: 'plunk' as const, link: '/admin/subscribers', dedupeKey: `plunk:${id}` }

  if (activity.type === 'email.complaint') {
    return { ...shared, severity: 'critical', title: 'Spam complaint in Plunk', message: `A recipient marked an email (${what}) as spam at ${when}. ${COMPLAINT_STAKES}` }
  }
  if (activity.type === 'email.bounced') {
    return { ...shared, severity: 'warning', title: 'Email bounced (permanent)', message: `An email (${what}) bounced permanently at ${when}.` }
  }
  return null
}

export async function runPollPlunkActivity(now: Date = new Date()): Promise<void> {
  if (!config.plunk.secretKey) {
    log.info('PLUNK_SECRET_KEY not set, nothing to poll')
    return
  }
  const { activityLookbackDays, activityPageLimit, activityMaxPages } = config.plunk
  const startDate = new Date(now.getTime() - activityLookbackDays * DAY_MS)

  let cursor: string | null = null
  let pages = 0
  let items = 0
  do {
    // Fail loudly rather than succeed quietly: a complaint beyond the limit would otherwise never be
    // read (for example if the API ignored the types filter). Notices already recorded are kept.
    if (pages >= activityMaxPages) {
      throw new Error(`Plunk activity poll stopped at the page limit (${pages} pages, ${items} items); older activity in the window was not read`)
    }
    const page = await listActivity({ types: TYPES, startDate, cursor, limit: activityPageLimit })
    pages++
    items += page.items.length
    for (const activity of page.items) {
      const notice = activityNotice(activity)
      if (notice) await notify(notice, { reopen: false })
    }
    cursor = page.hasMore ? page.nextCursor : null
  } while (cursor)

  log.info({ pages, items, startDate }, 'Plunk activity polled')
}
