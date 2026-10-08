/**
 * Back up every Plunk contact to one JSON file. Plunk itself has no export.
 *
 * RUN IT BEFORE EITHER CLEANUP (cleanup-plunk-contacts.ts deletes contacts,
 * cleanup-fast-confirmations.ts unsubscribes them), so restore-plunk-contacts.ts
 * can bring back anything removed by mistake.
 *
 * Strictly read-only: it pages through GET /contacts and changes nothing in
 * Plunk. It writes <repo>/DOCS/YYYY-MM-DD_plunk-contacts-backup.json (UTC date;
 * DOCS/ is gitignored), never overwriting: if that name exists it adds -HHMM,
 * then -HHMMSS. The file holds { exportedAt, plunkBaseUrl, count, contacts },
 * each contact exactly as Plunk returned it, custom data included.
 *
 * The file holds subscriber addresses (personal data). Keep it only on the
 * owner's machine, never commit or share it, and delete it once the cleanup has
 * proven right (a few weeks).
 *
 * RUN IT ON THE OWNER'S MACHINE, not on Render (Render's disk is wiped on
 * deploy). It needs only the Plunk secret key, no database. dotenv does not
 * override a variable already set, so in PowerShell:
 *
 *   $env:PLUNK_SECRET_KEY="sk_..."
 *   npm run backup:plunk-contacts --prefix server
 *   Remove-Item Env:PLUNK_SECRET_KEY
 *
 * It prints counts and the file path, never addresses.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const PAGE_SIZE = 100
const MAX_PAGES = 10_000

/** <repo>/DOCS, resolved from this file (server/src/scripts). */
export const DOCS_DIR = path.resolve(__dirname, '../../../DOCS')

/** The raw contact as Plunk returns it; only `email` and `subscribed` are relied on. */
export type RawContact = Record<string, unknown> & { id?: unknown; email?: unknown; subscribed?: unknown }

export interface ContactsPage {
  items: RawContact[]
  nextCursor: string | null
  hasMore: boolean
  total: number
}

export type ListPage = (cursor: string | undefined, limit: number) => Promise<ContactsPage>

export interface FetchAllResult {
  contacts: RawContact[]
  pages: number
  /** The total Plunk reported, or null when the response carried none. */
  reportedTotal: number | null
}

/**
 * Page through all contacts. Throws when Plunk announces more pages without a
 * cursor, or repeats a cursor, so a paging fault cannot pass as a complete list.
 */
export async function fetchAllContacts(listPage: ListPage, pageSize = PAGE_SIZE): Promise<FetchAllResult> {
  const contacts: RawContact[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  let reportedTotal: number | null = null

  while (true) {
    if (pages >= MAX_PAGES) throw new Error(`stopped after ${MAX_PAGES} pages; paging looks stuck`)
    const page = await listPage(cursor, pageSize)
    pages++
    if (pages === 1) {
      // parseContactsResponse fills `total` with the page length when Plunk sends none;
      // it is a real total only if it differs from that, or there is just one page.
      reportedTotal = page.total !== page.items.length || !page.hasMore ? page.total : null
    }
    contacts.push(...page.items)
    if (!page.hasMore) break
    if (!page.nextCursor) throw new Error(`Plunk reported more contacts after page ${pages} but sent no cursor`)
    if (seenCursors.has(page.nextCursor)) throw new Error(`Plunk repeated a cursor after page ${pages}`)
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return { contacts, pages, reportedTotal }
}

export interface BackupSummary {
  count: number
  subscribed: number
  unsubscribed: number
  /** Contacts whose `subscribed` is neither true nor false. */
  unknownStatus: number
  /** Ids seen more than once (a paging fault). */
  duplicateIds: number
  /** Contacts without a usable email. */
  missingEmail: number
}

export function summarizeContacts(contacts: RawContact[]): BackupSummary {
  const ids = new Set<string>()
  let duplicateIds = 0
  let subscribed = 0
  let unsubscribed = 0
  let unknownStatus = 0
  let missingEmail = 0
  for (const c of contacts) {
    if (c.subscribed === true) subscribed++
    else if (c.subscribed === false) unsubscribed++
    else unknownStatus++
    if (typeof c.email !== 'string' || !c.email.trim()) missingEmail++
    if (typeof c.id === 'string') {
      if (ids.has(c.id)) duplicateIds++
      else ids.add(c.id)
    }
  }
  return { count: contacts.length, subscribed, unsubscribed, unknownStatus, duplicateIds, missingEmail }
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The backup file name, never an existing one: YYYY-MM-DD_plunk-contacts-backup.json
 * (UTC), else with -HHMM, else -HHMMSS, else a counter.
 */
export function chooseBackupFileName(now: Date, exists: (name: string) => boolean): string {
  const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`
  const hhmm = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  const ss = pad(now.getUTCSeconds())
  const base = `${date}_plunk-contacts-backup`
  const candidates = [`${base}.json`, `${base}-${hhmm}.json`, `${base}-${hhmm}${ss}.json`]
  for (const name of candidates) if (!exists(name)) return name
  for (let i = 2; ; i++) {
    const name = `${base}-${hhmm}${ss}-${i}.json`
    if (!exists(name)) return name
  }
}

export interface BackupFile {
  exportedAt: string
  plunkBaseUrl: string
  count: number
  contacts: RawContact[]
}

async function main() {
  const extra = process.argv.slice(2)
  if (extra.length > 0) throw new Error(`Unknown argument: ${extra[0]} (this script takes none)`)

  const { config } = await import('../config.js')
  if (!config.plunk.secretKey) throw new Error('PLUNK_SECRET_KEY is not set')
  const plunk = await import('../services/plunk.js')

  console.log('Plunk contact backup (read-only)')
  const { contacts, pages, reportedTotal } = await fetchAllContacts(
    // The typed Contact is the same raw object Plunk returned (parseContactsResponse maps no fields).
    (cursor, limit) => plunk.listContacts(cursor, limit) as unknown as Promise<ContactsPage>,
  )
  const summary = summarizeContacts(contacts)

  const problems: string[] = []
  if (reportedTotal !== null && reportedTotal !== summary.count) {
    problems.push(`Plunk reported a total of ${reportedTotal} but ${summary.count} contacts were paged`)
  }
  if (summary.duplicateIds > 0) problems.push(`${summary.duplicateIds} contact ids appeared more than once`)

  const exportedAt = new Date()
  const backup: BackupFile = {
    exportedAt: exportedAt.toISOString(),
    plunkBaseUrl: config.plunk.baseUrl,
    count: contacts.length,
    contacts,
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true })
  const name = chooseBackupFileName(exportedAt, (n) => fs.existsSync(path.join(DOCS_DIR, n)))
  const filePath = path.join(DOCS_DIR, name)
  // 'wx' fails if the file appeared in the meantime: never overwrite.
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })

  console.log(`Pages read: ${pages}`)
  console.log(`Contacts:     ${summary.count}${reportedTotal !== null ? ` (Plunk reported ${reportedTotal})` : ' (Plunk reported no total)'}`)
  console.log(`Subscribed:   ${summary.subscribed}`)
  console.log(`Unsubscribed: ${summary.unsubscribed}`)
  if (summary.unknownStatus > 0) console.log(`No subscribed flag: ${summary.unknownStatus}`)
  if (summary.missingEmail > 0) console.log(`Without an email: ${summary.missingEmail}`)
  console.log(`\nWritten to ${filePath}`)
  console.log('It holds subscriber addresses: keep it on this machine only, never commit or share it, delete it once the cleanup has proven right.')

  if (problems.length > 0) {
    for (const p of problems) console.error(`WARNING: ${p}`)
    console.error('The backup may be incomplete. Do not run a cleanup on the strength of it.')
    process.exitCode = 1
  }
}

// Only run when executed directly (so importing the file for tests has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
