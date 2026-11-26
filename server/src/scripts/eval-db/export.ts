/**
 * Export the stories-only eval copy (`.context/database-migrations.md`, "A Stories-Only Copy for Cloud
 * Evals"): the owner runs it against his local database, through the eval's read-only session, and
 * takes the file to the cloud session's project files.
 *
 *   npm run db:export:eval --prefix server -- --out ../DOCS/2026-11-26_eval-db.jsonl.gz
 *
 * Reads DATABASE_URL as the evals do (server/.env, a value in the shell winning) and prints only
 * local or remote for it; writes nothing to any database.
 */
import 'dotenv/config'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyDb, openReadOnlyDb, readOnlyStatus } from '../eval/readOnlyDb.js'
import { exportEvalCopy, type ExportSummary } from './exportCopy.js'
import { EXCLUDED_TABLES } from './tables.js'

const say = (message: string) => console.log(`[eval-copy] ${message}`)
const fail = (message: string) => console.error(`[eval-copy] ${message}`)

const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

/** What the command prints about a finished export. */
function describeExport(s: ExportSummary, out: string): string[] {
  const stories = s.counts.stories ?? 0
  const scrubbed = Object.entries(s.scrubbed).map(([column, n]) => `${column} (${n})`)
  return [
    ...Object.entries(s.counts).map(([table, n]) => `${table}: ${n} rows`),
    `scrubbed values: ${scrubbed.length > 0 ? scrubbed.join(', ') : 'none'}`,
    ...(s.absentTables.length > 0 ? [`not in this database: ${s.absentTables.join(', ')}`] : []),
    ...(s.absentColumns.length > 0 ? [`columns not in this database: ${s.absentColumns.join(', ')}`] : []),
    `left out: ${Object.keys(EXCLUDED_TABLES).join(', ')}`,
    `database migration: ${s.migration ?? 'none'}`,
    `wrote ${out}: ${size(s.bytes)}${stories > 0 ? `, ${size((s.bytes / stories) * 1000)} per 1,000 stories` : ''}`,
  ]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--out')
  const out = at >= 0 ? argv[at + 1] : undefined
  if (!out) {
    fail('name the file to write: -- --out ../DOCS/<date>_eval-db.jsonl.gz')
    process.exitCode = 1
    return
  }
  console.log(`database: ${classifyDb(process.env.DATABASE_URL ?? '')}`)
  const db = await openReadOnlyDb().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err))
    return null
  })
  if (!db) {
    process.exitCode = 1
    return
  }
  try {
    say(`read-only session: ${await readOnlyStatus(db)} (${db.mode} mode)`)
    // The folder named (the gitignored DOCS/, usually) may not exist yet
    mkdirSync(dirname(resolve(out)), { recursive: true })
    for (const line of describeExport(await exportEvalCopy(db, resolve(out)), resolve(out))) say(line)
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  } finally {
    await db.close()
  }
}

// Only run when executed directly (so importing the file has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
