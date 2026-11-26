/**
 * Import the stories-only eval copy into a local `*_eval` database (`.context/database-migrations.md`,
 * "A Stories-Only Copy for Cloud Evals"), as a cloud session does before its evals:
 *
 *   EVAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/actually_relevant_eval \
 *     npm run db:import:eval --prefix server -- --in /mnt/project-files/eval-db/<date>_eval-db.jsonl.gz
 *
 * EVAL_DATABASE_URL comes from the shell, never from server/.env, and must name a local database whose
 * name ends in `_eval` (`guard.ts`): anything else is refused before a connection. The command applies
 * the repository's migrations to it (`prisma migrate deploy`, the project's own CLI), then replaces
 * everything in it with the copy.
 */
import { PrismaClient } from '@prisma/client'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runPrisma } from '../db-prepare/prismaCli.js'
import { classifyMigrateFailure, summarizeMigrateSuccess } from '../db-prepare/prismaOutput.js'
import { evalDatabaseRefusal } from './guard.js'
import { importEvalCopy } from './importCopy.js'

const say = (message: string) => console.log(`[eval-copy] ${message}`)
const fail = (message: string, output?: string) => {
  console.error(`[eval-copy] ${message}`)
  if (output) console.error(output.trim().split(/\r?\n/).slice(-15).join('\n'))
  process.exitCode = 1
}

const MIGRATE_HINTS: Record<ReturnType<typeof classifyMigrateFailure>, string> = {
  unreachable: 'cannot reach the database: is PostgreSQL running, and does the database exist (CREATE DATABASE)?',
  'failed-migration': 'a migration failed (see "Troubleshooting" in .context/database-migrations.md)',
  other: '`prisma migrate deploy` failed',
}

async function main(): Promise<void> {
  const url = process.env.EVAL_DATABASE_URL
  const refusal = evalDatabaseRefusal(url)
  if (refusal) return fail(refusal)
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--in')
  const file = at >= 0 ? argv[at + 1] : undefined
  if (!file) return fail('name the copy to import: -- --in <file>')
  if (!existsSync(file)) return fail(`no file at ${resolve(file)}`)
  const database = decodeURIComponent(new URL(url!.trim()).pathname.slice(1))

  const migrated = runPrisma(['migrate', 'deploy'], { ...process.env, DATABASE_URL: url })
  if (!migrated.ok) return fail(`could not migrate ${database}: ${MIGRATE_HINTS[classifyMigrateFailure(migrated.output)]}. Prisma said:`, migrated.output)
  const { applied } = summarizeMigrateSuccess(migrated.output)
  say(applied.length === 0 ? `${database}: migrations up to date` : `${database}: applied ${applied.length} migration(s)`)

  const db = new PrismaClient({ datasourceUrl: url })
  try {
    const s = await importEvalCopy(db, resolve(file))
    for (const [table, n] of Object.entries(s.counts)) say(`${table}: ${n} rows`)
    say(`the copy was made ${s.exportedAt} from a database at migration ${s.copyMigration ?? 'none'}; ${database} is at ${s.databaseMigration ?? 'none'}`)
    if (s.copyMigration !== s.databaseMigration) say('the two differ: a column added between them holds its default in every row')
    say(
      `run an eval against it with DATABASE_URL set to the same URL, e.g. DATABASE_URL=$EVAL_DATABASE_URL npm run eval:overviews --prefix server -- --out ../DOCS/<folder> --dry-run`,
    )
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  } finally {
    await db.$disconnect()
  }
}

// Only run when executed directly (so importing the file has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
