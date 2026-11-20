/**
 * What an automated re-center reads (`.context/overviews.md`, "Re-centering"), SELECT only through the
 * client given: the overviews automation may re-center, and for each whose link signals fire an attempt
 * its review case, its entries' dates, its founding entries, the stories it may take in and its
 * neighbors. The rules are `overviewRecenter.ts`'s (`recenterCaseOf`), which the eval's sandbox applies
 * to memory alike.
 */
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '../config.js'
import { membershipsOf, nearestPublished, type OverviewDb } from './overviewCandidates.js'
import { foundInputs, LINKED_AT, readInputs, signalSchema, SIGNALS } from './overviewDecisions.js'
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
  type TurnedAwayRow,
} from './overviewRecenter.js'
import { OVERVIEW_SCOPES, OVERVIEW_STATUSES } from './overviewTypes.js'
import { reviewCase } from './overviewUpkeepInput.js'
import { oneOf } from './storyContextRecords.js'

const signalList = z.array(signalSchema)

/** The signals key as a literal in the SQL, not a bound value, so the partial GIN index on `(inputs -> 'signals')` serves the query; held to the schema's name. */
const SIGNALS_SQL = Prisma.raw(`'${SIGNALS}'`)

/** The live link decisions naming an overview in a signal, through the GIN index `overview_decisions_link_signals`. */
export async function signalRecords(db: OverviewDb, overviewId: string): Promise<SignalRecord[]> {
  const decisions = await db.$queryRaw<{ story_id: string; signals: unknown; linked_at: string | null }[]>`
    SELECT story_id, inputs -> ${SIGNALS_SQL} AS signals, inputs ->> ${LINKED_AT} AS linked_at
    FROM overview_decisions
    WHERE kind = 'link' AND undone_at IS NULL AND story_id IS NOT NULL
      AND inputs -> ${SIGNALS_SQL} @> ${JSON.stringify([{ overviewId }])}::jsonb
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
 * frozen and below the limit of automated re-centers, those the editor's lock leaves to automation; the
 * live link decisions naming each in a signal (the GIN index `overview_decisions_link_signals`); the
 * stories those name and those a review detached from it, with their membership and its newest row
 * there; then `recenterCaseOf` decides, and the neighbors are read for the cases it keeps.
 */
export async function recenterCases(db: OverviewDb, at: { clock: Date; now: Date }, options: AttemptOptions = config.overviews): Promise<RecenterCase[]> {
  const overviews = await db.$queryRaw<
    {
      id: string
      scope: string
      status: string
      frozen: boolean
      automated_recenters: number
      recentered_at: Date | null
      recentered_by: string | null
      recenter_tried_at: Date | null
    }[]
  >`
    SELECT id, scope::text AS scope, status::text AS status, frozen, automated_recenters, recentered_at, recentered_by, recenter_tried_at
    FROM overviews
    WHERE scope = 'ongoing' AND status IN ('open', 'quiet') AND NOT frozen AND automated_recenters < ${options.maxAutomatedRecenters}
    ORDER BY founded_at, id
  `
  const cases: RecenterCase[] = []
  for (const o of overviews) {
    const state = {
      scope: oneOf(o.scope, OVERVIEW_SCOPES, 'single'),
      status: oneOf(o.status, OVERVIEW_STATUSES, 'open'),
      frozen: o.frozen,
      automatedRecenters: o.automated_recenters,
      recenteredAt: o.recentered_at,
      recenteredBy: o.recentered_by,
      recenterTriedAt: o.recenter_tried_at,
    }
    if (automatedRecenterBlocked(state, at.now, options)) continue
    const records = await signalRecords(db, o.id)
    if (!signalFires(signalsSince(o.id, records, o.recenter_tried_at), options)) continue
    const review = await reviewCase(db, o.id)
    if (!review) continue
    const [entryDates, founding, rowsHere] = await Promise.all([
      db.$queryRaw<{ id: string; date_published: Date }[]>`
        SELECT e.id, s.date_published FROM overview_entries e JOIN stories s ON s.id = e.story_id
        WHERE e.overview_id = ${o.id} AND e.status = 'active' AND s.date_published IS NOT NULL
      `,
      db.$queryRaw<{ inputs: unknown }[]>`
        SELECT inputs FROM overview_decisions WHERE overview_id = ${o.id} AND kind = 'found' AND outcome = 'founded' AND undone_at IS NULL
      `,
      // Each story's newest detached row here, and whether an editor locked any of its rows
      db.$queryRaw<{ story_id: string; id: string; detached_by: string | null; locked: boolean }[]>`
        SELECT story_id, (array_agg(id ORDER BY detached_at DESC NULLS LAST, id))[1] AS id,
               (array_agg(detached_by ORDER BY detached_at DESC NULLS LAST, id))[1] AS detached_by, bool_or(locked) AS locked
        FROM overview_entries
        WHERE overview_id = ${o.id} AND status = 'detached' AND story_id IS NOT NULL
        GROUP BY story_id
      `,
    ])
    const ids = [...new Set([...records.map(r => r.storyId), ...rowsHere.filter(r => r.detached_by === 'review').map(r => r.story_id)])]
    const [stories, memberships] = await Promise.all([linkStories(db, ids), membershipsOf(db, ids)])
    const rowOf = new Map(rowsHere.map(r => [r.story_id, r]))
    const quotesOf = (storyId: string) =>
      records.filter(r => r.storyId === storyId).flatMap(r => r.signals.filter(s => s.overviewId === o.id).map(s => s.quote))
    const rows: TurnedAwayRow[] = stories.map(s => {
      const row = rowOf.get(s.id)
      return {
        storyId: s.id,
        title: s.title,
        label: s.label,
        summary: s.summary,
        date: s.date,
        datePublished: s.datePublished,
        published: true,
        active: memberships.active.has(s.id),
        quotes: quotesOf(s.id),
        row: row ? { entryId: row.id, detachedBy: row.detached_by, locked: row.locked } : null,
      }
    })
    const partial = recenterCaseOf(
      {
        review,
        state,
        entryDates: new Map(entryDates.map(e => [e.id, e.date_published])),
        founding: founding.flatMap(f => (readInputs(foundInputs, f.inputs)?.created ?? []).flatMap(c => (c.table === 'entry' ? [c.id] : []))),
        records,
        rows,
      },
      at,
      options,
    )
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
