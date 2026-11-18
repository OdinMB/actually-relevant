/**
 * What the link prompts read (`.context/overviews.md`, "How a story is linked", step 2), SELECT only
 * through the client given (production's, or the eval's read-only session): a story as linking reads
 * it, with up to `MAX_LINK_FACTS` of its usable pool facts of pages as context, and a candidate
 * overview with its charter and its newest published entries.
 */
import { z } from 'zod'
import { utcDay } from '../lib/days.js'
import type { OverviewDb } from './overviewCandidates.js'
import type { CandidateOverview, Charter, LinkStory } from './overviewTypes.js'

/** Pool facts a story shows the link prompts at most, as context. */
export const MAX_LINK_FACTS = 10

/** An overview's newest entries the link prompt shows. */
export const CANDIDATE_ENTRIES = 5

interface StoryRow {
  id: string
  title: string
  label: string
  summary: string
  date_published: Date
  issue_id: string | null
}

/** The stories as linking reads them, in the order asked; a story not published, or without a date, is left out. */
export async function linkStories(db: OverviewDb, ids: readonly string[]): Promise<LinkStory[]> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return []
  const rows = await db.$queryRaw<StoryRow[]>`
    SELECT s.id, COALESCE(s.title, s.source_title) AS title, COALESCE(s.title_label, '') AS label,
           COALESCE(s.summary, '') AS summary, s.date_published, s.issue_id
    FROM stories s
    WHERE s.id = ANY(${wanted}::text[]) AND s.status = 'published' AND s.date_published IS NOT NULL
  `
  // Usable (supported, not demoted) facts of pages, never of our own earlier stories
  const facts = await db.$queryRaw<{ story_id: string; statement: string }[]>`
    SELECT f.story_id, f.statement
    FROM pool_facts f
    JOIN evidence_sources es ON es.id = f.source_id
    WHERE f.story_id = ANY(${wanted}::text[]) AND f.verdict = 'supported' AND f.status <> 'demoted' AND es.origin <> 'earlier'
    ORDER BY f.story_id, f.created_at, f.ref
  `
  const factsOf = new Map<string, string[]>()
  for (const f of facts) {
    const list = factsOf.get(f.story_id) ?? []
    if (list.length < MAX_LINK_FACTS) factsOf.set(f.story_id, [...list, f.statement])
  }
  const byId = new Map(rows.map(r => [r.id, r]))
  return wanted.flatMap(id => {
    const r = byId.get(id)
    if (!r) return []
    return [
      {
        id: r.id,
        title: r.title,
        label: r.label,
        summary: r.summary,
        datePublished: r.date_published,
        date: utcDay(r.date_published),
        issueId: r.issue_id,
        facts: factsOf.get(r.id) ?? [],
      },
    ]
  })
}

const charterSchema = z.object({ in: z.string(), out: z.array(z.string()), endEvent: z.string() })

/** A stored charter, or null when the column does not hold one. */
export const parseCharter = (value: unknown): Charter | null => charterSchema.safeParse(value).data ?? null

/** The overviews as the link prompt shows them, in the order asked: title, charter and newest published entries. An overview whose charter does not parse is left out. */
export async function candidateOverviews(db: OverviewDb, ids: readonly string[]): Promise<CandidateOverview[]> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return []
  const rows = await db.$queryRaw<{ id: string; title: string; charter: unknown }[]>`
    SELECT id, title, charter FROM overviews WHERE id = ANY(${wanted}::text[])
  `
  const entries = await db.$queryRaw<{ overview_id: string; title: string; date_published: Date }[]>`
    SELECT overview_id, title, date_published FROM (
      SELECT e.overview_id, COALESCE(s.title, s.source_title) AS title, s.date_published,
             row_number() OVER (PARTITION BY e.overview_id ORDER BY s.date_published DESC, s.id) AS n
      FROM overview_entries e
      JOIN stories s ON s.id = e.story_id
      WHERE e.status = 'active' AND s.status = 'published' AND s.date_published IS NOT NULL AND e.overview_id = ANY(${wanted}::text[])
    ) newest
    WHERE n <= ${CANDIDATE_ENTRIES}
    ORDER BY overview_id, n
  `
  const entriesOf = new Map<string, { title: string; date: string }[]>()
  for (const e of entries) entriesOf.set(e.overview_id, [...(entriesOf.get(e.overview_id) ?? []), { title: e.title, date: utcDay(e.date_published) }])
  const byId = new Map(rows.map(r => [r.id, r]))
  return wanted.flatMap(id => {
    const r = byId.get(id)
    const charter = r ? parseCharter(r.charter) : null
    return r && charter ? [{ id, title: r.title, charter, entries: entriesOf.get(id) ?? [] }] : []
  })
}
