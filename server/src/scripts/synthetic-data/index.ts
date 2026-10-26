/**
 * Fill a local database with the synthetic data set: made-up issues, feeds, stories in every
 * pipeline status, a dedup cluster, newsletter issues, podcast episodes and an admin login, with no
 * OpenAI or other paid call (`.context/database-migrations.md`, "Run Locally with Synthetic Data").
 *
 *   SYNTHETIC_DATABASE_URL=postgresql://ardev:ardev_local@localhost:5433/actually_relevant_synthetic \
 *     npm run db:seed:synthetic --prefix server [-- --reset]
 *
 * The URL comes from the shell, never from server/.env, and must name a local database whose name
 * ends in `_synthetic` (`guard.ts`). Apply the migrations to it first, with db:prepare.
 */
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'
import { SYNTHETIC_ADMIN } from './dataset.js'
import { syntheticDatabaseRefusal } from './guard.js'
import { describeSummary, seedSyntheticData } from './seed.js'

const say = (message: string) => console.log(`[synthetic] ${message}`)
const fail = (message: string) => console.error(`[synthetic] ${message}`)

async function main(): Promise<void> {
  const url = process.env.SYNTHETIC_DATABASE_URL
  const refusal = syntheticDatabaseRefusal(url)
  if (refusal) {
    fail(refusal)
    process.exitCode = 1
    return
  }

  const db = new PrismaClient({ datasourceUrl: url })
  try {
    say(describeSummary(await seedSyntheticData(db, { now: new Date(), reset: process.argv.includes('--reset') })))
    say(`admin login: ${SYNTHETIC_ADMIN.email} / ${SYNTHETIC_ADMIN.password}`)
    say(
      'start the server with the run line in .context/database-migrations.md ("Run Locally with Synthetic Data"): it replaces the outbound credentials from server/.env with placeholders',
    )
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
    // P2021: a table is missing, so the migrations were never applied to this database
    if ((err as { code?: string }).code === 'P2021') fail('apply the migrations first: DATABASE_URL=<the same URL> npm run db:prepare --prefix server')
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

// Only run when executed directly (so importing the file has no side effects).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
