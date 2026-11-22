/**
 * The overviews row and its entries as the loaders read them (`.context/overviews.md`, "Files"): one
 * column list for the raw SQL reads, typed so a field the write model's row has and the list forgets is
 * a type error, and one parser each from the columns to the rows (`overviewRowFrom`: the charter and
 * `lockedOut` parsed, the enums held to their values; `caseEntryFrom`), and a loader's rows with any
 * whose charter does not parse left out and logged (`readableOverviews`). The applier reads the row
 * through Prisma and parses it here too.
 */
import { Prisma } from '@prisma/client'
import { createLogger } from '../lib/logger.js'
import type { OverviewRow } from './overviewChanges.js'
import type { OverviewDb } from './overviewCandidates.js'
import type { CaseEntry } from './overviewCases.js'
import { parseCharter } from './overviewInput.js'
import { ENTRY_ROLES, OVERVIEW_SCOPES, OVERVIEW_STATUSES } from './overviewTypes.js'
import { oneOf } from './storyContextRecords.js'

const log = createLogger('overview-rows')

/** An overview row as read, before its JSON columns and enums are parsed. */
export type RawOverview = Omit<OverviewRow, 'charter' | 'lockedOut' | 'scope' | 'status'> & {
  charter: unknown
  lockedOut: unknown
  scope: string
  status: string
}

/** Each field's column of the overviews table. */
const OVERVIEW_FIELDS: { readonly [K in keyof RawOverview]-?: string } = {
  id: 'id',
  issueId: 'issue_id',
  foundedAt: 'founded_at',
  title: 'title',
  slug: 'slug',
  scope: 'scope::text',
  status: 'status::text',
  closedAt: 'closed_at',
  closedReason: 'closed_reason',
  frozen: 'frozen',
  frozenBy: 'frozen_by',
  frozenAt: 'frozen_at',
  hidden: 'hidden',
  charter: 'charter',
  charterModel: 'charter_model',
  charterPromptVersion: 'charter_prompt_version',
  recenteredAt: 'recentered_at',
  recenteredBy: 'recentered_by',
  recenterUndoneAt: 'recenter_undone_at',
  recenterTriedAt: 'recenter_tried_at',
  automatedRecenters: 'automated_recenters',
  entriesAtLastReview: 'entries_at_last_review',
  reviewedAt: 'reviewed_at',
  reopenedAt: 'reopened_at',
  joinsCountedFrom: 'joins_counted_from',
  lockedOut: 'locked_out',
  lastEntryAt: 'last_entry_at',
}

/** The Prisma select of the same fields: the applier's read. */
export const OVERVIEW_SELECT = Object.fromEntries(Object.keys(OVERVIEW_FIELDS).map(k => [k, true])) as { readonly [K in keyof RawOverview]: true }

/** The columns of `RawOverview`, of the overviews table aliased `o`. */
export const OVERVIEW_COLUMNS = Prisma.raw(
  Object.entries(OVERVIEW_FIELDS)
    .map(([field, column]) => `o.${column} AS "${field}"`)
    .join(', '),
)

/** The OUT entries an editor's undo locked out, as the column stores them. */
export const lockedOutOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])

/** An overview row with its charter and `lockedOut` parsed and its enums held to their values; null when its charter does not parse. */
export function overviewRowFrom(raw: RawOverview): OverviewRow | null {
  const charter = parseCharter(raw.charter)
  if (!charter) return null
  return {
    ...raw,
    charter,
    lockedOut: lockedOutOf(raw.lockedOut),
    scope: oneOf(raw.scope, OVERVIEW_SCOPES, 'single'),
    status: oneOf(raw.status, OVERVIEW_STATUSES, 'open'),
  }
}

/**
 * The rows of a read with their charters parsed (`overviewRowFrom`), leaving out each whose charter
 * does not parse, with a warning naming it and the read (`read`) that skipped it: only a row written
 * outside the lifecycle can have one, and nothing but the log would say why it gets no upkeep.
 */
export function readableOverviews(raws: readonly RawOverview[], read: string): OverviewRow[] {
  return raws.flatMap(r => {
    const row = overviewRowFrom(r)
    if (!row) log.warn({ overviewId: r.id, read }, 'overview left out of the read: its charter does not parse')
    return row ?? []
  })
}

/** An entry as read, before its enums are parsed. */
type RawCaseEntry = Omit<CaseEntry, 'status' | 'role'> & { status: string; role: string }

/** Each field's column, of the overview_entries table aliased `e` joined to its story as `s`. */
const CASE_ENTRY_FIELDS: { readonly [K in keyof RawCaseEntry]-?: string } = {
  id: 'e.id',
  overviewId: 'e.overview_id',
  storyId: 'e.story_id',
  joinedBy: 'e.joined_by',
  joinedAt: 'e.joined_at',
  status: 'e.status::text',
  detachedBy: 'e.detached_by',
  detachReason: 'e.detach_reason',
  detachedAt: 'e.detached_at',
  locked: 'e.locked',
  role: 'e.role::text',
  roleKind: 'e.role_kind',
  published: "(s.status = 'published')",
  datePublished: 's.date_published',
  title: 'COALESCE(s.title, s.source_title)',
  label: "COALESCE(s.title_label, '')",
  summary: "COALESCE(s.summary, '')",
}

const CASE_ENTRY_COLUMNS = Prisma.raw(
  Object.entries(CASE_ENTRY_FIELDS)
    .map(([field, column]) => `${column} AS "${field}"`)
    .join(', '),
)

export const caseEntryFrom = (raw: RawCaseEntry): CaseEntry => ({
  ...raw,
  status: raw.status === 'detached' ? 'detached' : 'active',
  role: oneOf(raw.role, ENTRY_ROLES, 'routine'),
})

/** The entries of the overviews given with their stories, as the cases read them; only the active ones with `active`. */
export async function readCaseEntries(db: OverviewDb, overviewIds: readonly string[], which: 'all' | 'active'): Promise<CaseEntry[]> {
  if (overviewIds.length === 0) return []
  const status = which === 'active' ? Prisma.sql`AND e.status = 'active'` : Prisma.empty
  const rows = await db.$queryRaw<RawCaseEntry[]>`
    SELECT ${CASE_ENTRY_COLUMNS}
    FROM overview_entries e JOIN stories s ON s.id = e.story_id
    WHERE e.overview_id = ANY(${[...overviewIds]}::text[]) ${status}
  `
  return rows.map(caseEntryFrom)
}

/** The overviews given, as the cases read them; one gone, or without a readable charter, is left out. */
export async function readOverviewRows(db: OverviewDb, overviewIds: readonly string[]): Promise<OverviewRow[]> {
  if (overviewIds.length === 0) return []
  const rows = await db.$queryRaw<RawOverview[]>`SELECT ${OVERVIEW_COLUMNS} FROM overviews o WHERE o.id = ANY(${[...overviewIds]}::text[])`
  return readableOverviews(rows, 'the cases')
}
