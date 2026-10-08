/**
 * Unsubscribe pre-June newsletter contacts that confirmed suspiciously fast.
 *
 * Before 2026-06-03 the confirm link changed state on GET, so an email scanner
 * prefetching the link "confirmed" a bot-submitted address within seconds of
 * the signup. Those addresses are subscribed in Plunk but never asked for the
 * newsletter, and one complaint from them can disable the Plunk account again
 * (it cannot reset complaint stats; below about 5,800 total sends a single
 * complaint is enough). This script finds confirmed PendingSubscription rows
 * created before the cutoff whose confirmedAt - createdAt gap is below a
 * threshold, and UNSUBSCRIBES (never deletes) their Plunk contact, so a real
 * person caught by mistake can simply sign up again.
 *
 * Protected, never touched:
 *   - anyone with a confirmed signup created on or after the cutoff
 *     (a genuine re-confirmation through the human-click flow);
 *   - anyone with any pre-cutoff confirmation at or above the threshold
 *     (a human-paced confirmation);
 *   - Plunk contacts that are not currently subscribed.
 *
 * Preview by default: changes nothing, prints the distribution of confirmation
 * gaps for ALL pre-cutoff confirmations so the threshold can be chosen from
 * data, and with --max-seconds=N lists the addresses that would be unsubscribed.
 * Preview reads only the database; Plunk is contacted only in apply mode.
 *
 *   npm run cleanup:fast-confirmations --prefix server                         # gap distribution
 *   npm run cleanup:fast-confirmations --prefix server -- --max-seconds=10     # + candidate list
 *   npm run cleanup:fast-confirmations:apply --prefix server -- --max-seconds=10
 *
 * Flags: --max-seconds=N (required with --apply; a gap strictly below N counts
 * as fast), --before=YYYY-MM-DD (cutoff, default 2026-06-03).
 *
 * RUN IT FROM THE RENDER API SERVICE'S SHELL, NEVER LOCALLY. It needs the
 * production DATABASE_URL and Plunk key that are set there. Run locally, the
 * candidates and the "re-confirmed" protection set would come from the dev
 * database, and apply would unsubscribe the wrong people in production Plunk.
 *
 * NOTE: apply requires the Plunk account to be ACTIVE — while it is suspended
 * the API returns 403 (PROJECT_DISABLED).
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

import { PrismaClient } from '@prisma/client'

export const DEFAULT_CUTOFF = new Date('2026-06-03T00:00:00.000Z')
const PAGE_SIZE = 100
const UPDATE_DELAY_MS = 200

export interface Args {
  apply: boolean
  maxSeconds: number | null
  cutoff: Date
}

export interface SignupRow {
  email: string
  createdAt: Date
  confirmedAt: Date | null
}

export interface Candidate {
  email: string
  gapSeconds: number
}

/** Parse CLI flags. Throws on anything malformed or unknown, so a typo never falls back to defaults. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, maxSeconds: null, cutoff: DEFAULT_CUTOFF }
  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true
    } else if (arg.startsWith('--max-seconds=')) {
      const raw = arg.slice('--max-seconds='.length)
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n) || n <= 0) {
        throw new Error(`--max-seconds must be a positive number of seconds, got "${raw}"`)
      }
      args.maxSeconds = n
    } else if (arg.startsWith('--before=')) {
      const raw = arg.slice('--before='.length)
      const d = new Date(raw)
      if (raw.trim() === '' || Number.isNaN(d.getTime())) {
        throw new Error(`--before must be a date such as 2026-06-03, got "${raw}"`)
      }
      args.cutoff = d
    } else {
      throw new Error(`Unknown argument "${arg}". Allowed: --apply, --max-seconds=N, --before=YYYY-MM-DD`)
    }
  }
  return args
}

/** Apply must name its threshold explicitly; returns the refusal message, or null when allowed. */
export function applyGuardError(args: Args): string | null {
  if (args.apply && args.maxSeconds === null) {
    return 'Refusing to apply without an explicit --max-seconds=N. Run the preview first and choose N from the gap distribution.'
  }
  return null
}

/** Seconds between signup and confirmation, never negative. Call only for confirmed rows. */
export function gapSeconds(row: SignupRow): number {
  if (!row.confirmedAt) return Number.POSITIVE_INFINITY
  return Math.max(0, (row.confirmedAt.getTime() - row.createdAt.getTime()) / 1000)
}

const BUCKETS: { label: string; upTo: number }[] = [
  { label: '<5s', upTo: 5 },
  { label: '5-10s', upTo: 10 },
  { label: '10-30s', upTo: 30 },
  { label: '30-60s', upTo: 60 },
  { label: '1-5min', upTo: 300 },
  { label: '5-60min', upTo: 3600 },
  { label: '>1h', upTo: Number.POSITIVE_INFINITY },
]

/** Distribution of confirmation gaps over every confirmed row created before the cutoff. */
export function bucketGaps(rows: SignupRow[], cutoff: Date): { label: string; count: number }[] {
  const counts = BUCKETS.map((b) => ({ label: b.label, count: 0 }))
  for (const r of rows) {
    if (!r.confirmedAt || r.createdAt >= cutoff) continue
    const gap = gapSeconds(r)
    const i = BUCKETS.findIndex((b) => gap < b.upTo)
    counts[i].count++
  }
  return counts
}

/**
 * Addresses (lowercased, deduped) whose every pre-cutoff confirmation was faster
 * than maxSeconds. Addresses with a confirmed signup created on or after the
 * cutoff are returned separately as `reconfirmed` and never become candidates.
 */
export function selectFastConfirmations(
  rows: SignupRow[],
  cutoff: Date,
  maxSeconds: number,
): { candidates: Candidate[]; reconfirmed: string[] } {
  const reconfirmed = new Set<string>()
  const humanPaced = new Set<string>()
  const fastest = new Map<string, number>()

  for (const r of rows) {
    if (!r.confirmedAt) continue
    const email = r.email.toLowerCase()
    if (r.createdAt >= cutoff) {
      reconfirmed.add(email)
      continue
    }
    const gap = gapSeconds(r)
    if (gap < maxSeconds) {
      fastest.set(email, Math.min(gap, fastest.get(email) ?? Number.POSITIVE_INFINITY))
    } else {
      humanPaced.add(email)
    }
  }

  const candidates: Candidate[] = []
  const protectedReconfirmed: string[] = []
  for (const [email, gap] of fastest) {
    if (humanPaced.has(email)) continue
    if (reconfirmed.has(email)) {
      protectedReconfirmed.push(email)
      continue
    }
    candidates.push({ email, gapSeconds: gap })
  }
  candidates.sort((a, b) => a.gapSeconds - b.gapSeconds || a.email.localeCompare(b.email))
  return { candidates, reconfirmed: protectedReconfirmed.sort() }
}

/** Match candidates to Plunk contacts; only currently subscribed contacts are acted on. */
export function planUnsubscribes(
  candidates: Candidate[],
  contacts: { id: string; email: string; subscribed: boolean }[],
): { toUnsubscribe: (Candidate & { id: string; plunkEmail: string })[]; notSubscribed: string[] } {
  const byEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c]))
  const toUnsubscribe: (Candidate & { id: string; plunkEmail: string })[] = []
  const notSubscribed: string[] = []
  for (const cand of candidates) {
    const contact = byEmail.get(cand.email)
    if (contact && contact.subscribed === true) {
      toUnsubscribe.push({ id: contact.id, plunkEmail: contact.email, email: cand.email, gapSeconds: cand.gapSeconds })
    } else {
      notSubscribed.push(cand.email)
    }
  }
  return { toUnsubscribe, notSubscribed }
}

function formatGap(s: number): string {
  return s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}min`
}

async function main() {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  const guard = applyGuardError(args)
  if (guard) {
    console.error(guard)
    process.exit(1)
  }

  const prisma = new PrismaClient()
  console.log(`Fast-confirmation cleanup — mode: ${args.apply ? 'APPLY (will unsubscribe in Plunk)' : 'PREVIEW (changes nothing)'}`)
  console.log(`Cutoff: signups created before ${args.cutoff.toISOString()}`)

  const rows = await prisma.pendingSubscription.findMany({
    where: { confirmedAt: { not: null } },
    select: { email: true, createdAt: true, confirmedAt: true },
  })
  const preCutoff = rows.filter((r) => r.createdAt < args.cutoff)
  console.log(`Confirmed signup rows: ${rows.length} total, ${preCutoff.length} created before the cutoff.\n`)

  console.log('Confirmation gap distribution (pre-cutoff confirmed rows):')
  for (const b of bucketGaps(rows, args.cutoff)) {
    console.log(`  ${b.label.padEnd(8)} ${String(b.count).padStart(6)}`)
  }

  if (args.maxSeconds === null) {
    console.log('\nPreview complete. Re-run with --max-seconds=N to list the addresses below that gap.')
    await prisma.$disconnect()
    return
  }

  const { candidates, reconfirmed } = selectFastConfirmations(rows, args.cutoff, args.maxSeconds)
  console.log(`\nThreshold: gap below ${args.maxSeconds}s`)
  console.log(`Skipped, confirmed again after the cutoff: ${reconfirmed.length}`)
  for (const e of reconfirmed) console.log(`  keep (re-confirmed): ${e}`)
  console.log(`Candidates (every pre-cutoff confirmation below ${args.maxSeconds}s): ${candidates.length}`)
  for (const c of candidates) {
    console.log(`  ${args.apply ? 'candidate' : 'would unsubscribe'}: ${c.email} (gap ${formatGap(c.gapSeconds)})`)
  }

  if (!args.apply) {
    console.log(
      `\nPreview complete; nothing changed. Apply also skips addresses no longer subscribed in Plunk.\n` +
        `To unsubscribe: npm run cleanup:fast-confirmations:apply --prefix server -- --max-seconds=${args.maxSeconds}`,
    )
    await prisma.$disconnect()
    return
  }

  const plunk = await import('../services/plunk.js')
  const contacts: { id: string; email: string; subscribed: boolean }[] = []
  let cursor: string | undefined
  while (true) {
    const page = await plunk.listContacts(cursor, PAGE_SIZE)
    contacts.push(...page.items)
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  console.log(`\nScanned ${contacts.length} Plunk contacts.`)

  const { toUnsubscribe, notSubscribed } = planUnsubscribes(candidates, contacts)
  let unsubscribed = 0
  let failed = 0
  for (const c of toUnsubscribe) {
    try {
      // POST /contacts upserts by email: the same call the confirm flow uses in
      // production to set subscribed:true, so it is the proven way to flip the flag.
      const updated = await plunk.createContact({ email: c.plunkEmail, subscribed: false })
      if (updated && updated.subscribed !== false) {
        throw new Error(`Plunk answered subscribed=${String(updated.subscribed)}`)
      }
      unsubscribed++
      console.log(`  UNSUBSCRIBED: ${c.email} (gap ${formatGap(c.gapSeconds)})`)
    } catch (err) {
      failed++
      console.error(`  failed to unsubscribe ${c.email} (${c.id}):`, err instanceof Error ? err.message : err)
    }
    await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY_MS))
  }

  console.log(
    `\nDone. Unsubscribed: ${unsubscribed}, Skipped (not subscribed in Plunk): ${notSubscribed.length}, ` +
      `Skipped (re-confirmed after cutoff): ${reconfirmed.length}, Failed: ${failed}`,
  )
  await prisma.$disconnect()
}

// Only run when executed directly (so importing the file for tests has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
