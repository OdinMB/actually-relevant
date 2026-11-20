/**
 * What an automated re-center reads (`.context/overviews.md`, "Re-centering"), SELECT only through the
 * client given: the overviews automation may re-center, and for each whose link signals fire an attempt
 * the raw rows of its parts (its row, its entries, its founding decisions, the stories it may take in
 * and their membership) and its neighbors. The parts are built by `overviewCases.ts` (`recenterPartsOf`)
 * and decided by `overviewRecenter.ts` (`recenterCaseOf`), as the eval's sandbox does over memory.
 */
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '../config.js'
import { membershipsOf, nearestPublished, type OverviewDb } from './overviewCandidates.js'
import { recenterPartsOf, recenterStoryIds } from './overviewCases.js'
import { foundingEntries, LINKED_AT, signalSchema, SIGNALS } from './overviewDecisions.js'
import { candidateOverviews, linkStories } from './overviewInput.js'
import {
  automatedRecenterBlocked,
  neighbourOverviews,
  neighbourStories,
  recenterCaseOf,
  signalFires,
  signalsSince,
  type AttemptOptions,
  type RecenterCase,
  type SignalRecord,
} from './overviewRecenter.js'
import { OVERVIEW_COLUMNS, overviewRowFrom, readCaseEntries, type RawOverview } from './overviewRow.js'

const signalList = z.array(signalSchema)

/** The signals key as a literal in the SQL, not a bound value, so the partial GIN index on `(inputs -> 'signals')` serves the query; held to the schema's name. */
const SIGNALS_SQL = Prisma.raw(`'${SIGNALS}'`)

/**
 * The live link decisions naming an overview in a signal, through the GIN index
 * `overview_decisions_link_signals`; with `since`, only those linked after it (what `signalsSince`
 * counts from it), so a night's check reads the signals since the last attempt, not the whole history.
 */
export async function signalRecords(db: OverviewDb, overviewId: string, since: Date | null = null): Promise<SignalRecord[]> {
  const after = since ? Prisma.sql`AND (inputs ->> ${LINKED_AT})::timestamptz > ${since}` : Prisma.empty
  const decisions = await db.$queryRaw<{ story_id: string; signals: unknown; linked_at: string | null }[]>`
    SELECT story_id, inputs -> ${SIGNALS_SQL} AS signals, inputs ->> ${LINKED_AT} AS linked_at
    FROM overview_decisions
    WHERE kind = 'link' AND undone_at IS NULL AND story_id IS NOT NULL
      AND inputs -> ${SIGNALS_SQL} @> ${JSON.stringify([{ overviewId }])}::jsonb
      ${after}
  `
  return decisions.map(d => ({
    storyId: d.story_id,
    signals: signalList.safeParse(d.signals).data ?? [],
    linkedAt: d.linked_at ? new Date(d.linked_at) : null,
  }))
}

/**
 * The overviews an automated re-center is due on at the development clock `clock` and the wall clock
 * `now`, oldest founding first, each with its neighbors: of the ongoing overviews, open or quiet, not
 * frozen and below the limit of automated re-centers, those no lock keeps from automation; the live
 * link decisions naming each in a signal since its last attempt (the GIN index
 * `overview_decisions_link_signals`), and for one whose signals fire them all; its entries and its
 * `found` decisions; the stories `recenterStoryIds` names, with their membership; then
 * `recenterPartsOf` builds the parts, `recenterCaseOf` decides, and the neighbors are read for the
 * cases it keeps.
 */
export async function recenterCases(db: OverviewDb, at: { clock: Date; now: Date }, options: AttemptOptions = config.overviews): Promise<RecenterCase[]> {
  const overviews = (
    await db.$queryRaw<RawOverview[]>`
      SELECT ${OVERVIEW_COLUMNS}
      FROM overviews o
      WHERE o.scope = 'ongoing' AND o.status IN ('open', 'quiet') AND NOT o.frozen AND o.automated_recenters < ${options.maxAutomatedRecenters}
      ORDER BY o.founded_at, o.id
    `
  ).flatMap(r => overviewRowFrom(r) ?? [])
  const cases: RecenterCase[] = []
  for (const o of overviews) {
    if (automatedRecenterBlocked(o, at.now, options)) continue
    // Only the signals since the last attempt fire one; the stories an attempt may take in are flagged by any signal (D-RC6), so the whole history is read only for an overview whose signals fire
    const fresh = await signalRecords(db, o.id, o.recenterTriedAt)
    if (!signalFires(signalsSince(o.id, fresh, o.recenterTriedAt), options)) continue
    const records = o.recenterTriedAt === null ? fresh : await signalRecords(db, o.id)
    const [entries, decisions] = await Promise.all([
      readCaseEntries(db, [o.id], 'all'),
      db.$queryRaw<{ kind: string; outcome: string; undone: boolean; inputs: unknown }[]>`
        SELECT kind::text AS kind, outcome, (undone_at IS NOT NULL) AS undone, inputs FROM overview_decisions WHERE overview_id = ${o.id} AND kind = 'found'
      `,
    ])
    const ids = recenterStoryIds(o.id, entries, records)
    const [stories, memberships] = await Promise.all([linkStories(db, ids), membershipsOf(db, ids)])
    const parts = recenterPartsOf({ overview: o, entries, founding: foundingEntries(decisions), records, stories, active: new Set(memberships.active.keys()) })
    const partial = recenterCaseOf(parts, at, options)
    if (!partial) continue
    const neighbours = await neighbourOverviews(
      o.id,
      neighbourStories(partial, options),
      at.clock,
      {
        neighbours: (id, asOf) => nearestPublished(db, id, asOf, options),
        memberships: (storyIds, asOf) => membershipsOf(db, storyIds, asOf),
        overviews: (overviewIds, asOf) => candidateOverviews(db, overviewIds, asOf),
      },
      options,
    )
    cases.push({ ...partial, neighbours })
  }
  return cases
}
