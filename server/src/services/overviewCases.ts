/**
 * The upkeep's cases built from raw rows (`.context/overviews.md`, "The job"), pure: production's
 * loaders (`overviewUpkeepInput.ts`, `overviewRecenterInput.ts`) fetch the rows from the tables, the
 * eval's sandbox (`upkeepSandbox.ts`) gives them from memory, and these turn them into an overview's
 * review case, the closing checks due and a re-center's parts by one set of rules, as
 * `overviewStateOf` does for the status machine. A loader's SQL may leave rows out ahead of them as an
 * optimization, never in place of them.
 */
import { config } from '../config.js'
import { utcDay } from '../lib/days.js'
import type { EntryRow, OverviewRow } from './overviewChanges.js'
import type { CloseCase } from './overviewClose.js'
import { linkInputs, readInputs } from './overviewDecisions.js'
import type { RecenterParts, SignalRecord, TurnedAwayRow } from './overviewRecenter.js'
import type { ReviewCase } from './overviewReview.js'
import { namesEndEvent, ROLE_KINDS, type LinkStory, type Role } from './overviewTypes.js'
import { oneOf } from './storyContextRecords.js'

/** An entry as the cases read it: its row, and what the prompts show of its story. */
export interface CaseEntry extends EntryRow {
  title: string
  label: string
  summary: string
}

/** An overview's row as the cases read it. */
export type CaseOverview = Pick<OverviewRow, 'id' | 'title' | 'charter' | 'scope' | 'status' | 'frozen' | 'closingStoryId' | 'lockedOut'>

/** A decision as the cases read it. */
export interface CaseDecision {
  kind: string
  outcome: string
  overviewId: string | null
  storyId: string | null
  undone: boolean
  inputs: unknown
}

/** The close outcomes that leave a story to be judged again: a failed check is asked again, a stale one judged again. */
export const UNSETTLED_CLOSE_OUTCOMES: readonly string[] = ['failed', 'stale']

/** An entry's role as the prompts read it: a routine entry, or a turning point without a kind, has none. */
export const entryRole = (e: Pick<EntryRow, 'role' | 'roleKind'>): Role => ({
  role: e.role,
  roleKind: e.role === 'routine' || e.roleKind === null ? null : oneOf(e.roleKind, ROLE_KINDS, 'milestone'),
})

const time = (d: Date | null) => d?.getTime() ?? Number.NEGATIVE_INFINITY

/** Its active entries of published stories with a date, oldest first, a tie by story. */
function publishedEntries(overviewId: string, entries: readonly CaseEntry[]): (CaseEntry & { storyId: string; datePublished: Date })[] {
  return entries
    .filter(
      (e): e is CaseEntry & { storyId: string; datePublished: Date } =>
        e.overviewId === overviewId && e.status === 'active' && e.published && e.storyId !== null && e.datePublished !== null,
    )
    .sort((a, b) => a.datePublished.getTime() - b.datePublished.getTime() || a.storyId.localeCompare(b.storyId))
}

/**
 * An overview as its review reads it: title, charter, scope and freeze, its active entries of
 * published stories oldest first, while closing the story whose end-event report began it, and the OUT
 * entries an editor's undo locked out.
 */
export function reviewCaseOf(o: CaseOverview, entries: readonly CaseEntry[]): ReviewCase {
  return {
    overviewId: o.id,
    title: o.title,
    charter: o.charter,
    scope: o.scope,
    frozen: o.frozen,
    entries: publishedEntries(o.id, entries).map(e => ({
      entryId: e.id,
      storyId: e.storyId,
      title: e.title,
      label: e.label,
      summary: e.summary,
      date: utcDay(e.datePublished),
      role: entryRole(e),
      locked: e.locked,
    })),
    closingStoryId: o.status === 'closing' ? o.closingStoryId : null,
    lockedOut: o.lockedOut,
  }
}

/** What the closing checks due are built from. */
export interface CloseRows {
  /** The link decisions that may flag a story as reporting its overview's end event. */
  joins: readonly CaseDecision[]
  /** The close decisions of those stories: a settling one means the story was judged. */
  closes: readonly CaseDecision[]
  /** The overviews the joins name, with their entries. */
  overviews: readonly CaseOverview[]
  entries: readonly CaseEntry[]
  /** The stories as linking reads them (published only). */
  stories: ReadonlyMap<string, LinkStory>
}

/**
 * The closing checks due: each story a live `joined` link decision flagged as reporting its overview's
 * end event (`reportsEndEvent`), still an active member and published, of an overview that is open or
 * quiet, not frozen and names an end event (one with none closes only by fading, whatever was flagged
 * before an editor took it out), with no close decision for that pair but a failed or stale one (an
 * undone one included: an editor's undo of a closing is not judged again); oldest first. Each with the
 * overview's charter and its newest `candidateEntries` other entries published on or before the story's day.
 */
export function closeCasesOf(rows: CloseRows, options: Pick<typeof config.overviews, 'candidateEntries'> = config.overviews): CloseCase[] {
  const pair = (d: Pick<CaseDecision, 'overviewId' | 'storyId'>) => `${d.overviewId}:${d.storyId}`
  const judged = new Set(rows.closes.filter(d => d.kind === 'close' && !UNSETTLED_CLOSE_OUTCOMES.includes(d.outcome)).map(pair))
  const overviews = new Map(rows.overviews.map(o => [o.id, o]))
  const seen = new Set<string>()
  const cases: CloseCase[] = []
  for (const d of rows.joins) {
    if (d.kind !== 'link' || d.outcome !== 'joined' || d.undone || !readInputs(linkInputs, d.inputs)?.reportsEndEvent) continue
    const o = d.overviewId ? overviews.get(d.overviewId) : undefined
    const story = d.storyId ? rows.stories.get(d.storyId) : undefined
    if (!o || !story || judged.has(pair(d)) || seen.has(pair(d))) continue
    if ((o.status !== 'open' && o.status !== 'quiet') || o.frozen || !namesEndEvent(o.charter)) continue
    const members = publishedEntries(o.id, rows.entries)
    if (!members.some(e => e.storyId === story.id)) continue
    seen.add(pair(d))
    const others = members
      .filter(e => e.storyId !== story.id && e.datePublished.getTime() <= story.datePublished.getTime())
      .sort((a, b) => b.datePublished.getTime() - a.datePublished.getTime() || a.storyId.localeCompare(b.storyId))
      .slice(0, options.candidateEntries)
    cases.push({ overviewId: o.id, charter: o.charter, story, entries: others.map(e => ({ title: e.title, date: utcDay(e.datePublished) })) })
  }
  return cases.sort((a, b) => a.story.datePublished.getTime() - b.story.datePublished.getTime() || a.story.id.localeCompare(b.story.id))
}

/** Each story's newest detached row in the overview (newest detachment first, one never stamped last), and whether an editor locked any of its rows there. */
function detachedRows(overviewId: string, entries: readonly CaseEntry[]): Map<string, { row: CaseEntry; locked: boolean }> {
  const rows = new Map<string, { row: CaseEntry; locked: boolean }>()
  const detached = entries
    .filter(e => e.overviewId === overviewId && e.status === 'detached' && e.storyId !== null)
    .sort((a, b) => (time(b.detachedAt) > time(a.detachedAt) ? 1 : time(b.detachedAt) < time(a.detachedAt) ? -1 : a.id.localeCompare(b.id)))
  for (const e of detached) {
    const held = rows.get(e.storyId!)
    rows.set(e.storyId!, held ? { row: held.row, locked: held.locked || e.locked } : { row: e, locked: e.locked })
  }
  return rows
}

/** The stories a re-center weighs (D-RC6): those its signal records name, and those whose newest row in the overview a review detached. */
export function recenterStoryIds(overviewId: string, entries: readonly CaseEntry[], records: readonly SignalRecord[]): string[] {
  const reviewDetached = [...detachedRows(overviewId, entries)].filter(([, r]) => r.row.detachedBy === 'review').map(([id]) => id)
  return [...new Set([...records.map(r => r.storyId), ...reviewDetached])]
}

/** What a re-center's parts are built from. */
export interface RecenterRows {
  overview: CaseOverview & RecenterParts['state']
  /** All its entries, active and detached. */
  entries: readonly CaseEntry[]
  /** The entries its founding made (`foundingEntries`). */
  founding: readonly string[]
  /** The live link decisions with a signal for it. */
  records: readonly SignalRecord[]
  /** The stories `recenterStoryIds` names, as linking reads them (published only). */
  stories: readonly LinkStory[]
  /** Those that are an active entry of an overview, this one or another. */
  active: ReadonlySet<string>
}

/** A re-center's parts (`recenterCaseOf` decides on them): its review case, its state, its entries' dates, its founding, its signals and the stories it weighs. */
export function recenterPartsOf(rows: RecenterRows): RecenterParts {
  const o = rows.overview
  const here = detachedRows(o.id, rows.entries)
  const quotesOf = (storyId: string) =>
    rows.records.filter(r => r.storyId === storyId).flatMap(r => r.signals.filter(s => s.overviewId === o.id).map(s => s.quote))
  const weighed: TurnedAwayRow[] = rows.stories.map(s => {
    const row = here.get(s.id)
    return {
      storyId: s.id,
      title: s.title,
      label: s.label,
      summary: s.summary,
      date: s.date,
      datePublished: s.datePublished,
      published: true,
      active: rows.active.has(s.id),
      quotes: quotesOf(s.id),
      row: row ? { entryId: row.row.id, detachedBy: row.row.detachedBy, locked: row.locked } : null,
    }
  })
  return {
    review: reviewCaseOf(o, rows.entries),
    state: o,
    entryDates: new Map(
      rows.entries.flatMap(e => (e.overviewId === o.id && e.status === 'active' && e.datePublished ? [[e.id, e.datePublished] as const] : [])),
    ),
    founding: rows.founding,
    records: rows.records,
    rows: weighed,
  }
}
