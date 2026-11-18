/**
 * A story's Updates as readers get them (`.context/research-passes.md`, "Versions and Updates"): the
 * public contract's shape (`GET /api/stories/{slug}`, `updates`), the Updates a story's versions make,
 * with the sources they cite, and how they are served once earlier stories have moved or left. Pure:
 * `publicStories.ts` reads the versions and the slugs.
 */
import { z } from 'zod'
import { utcDay } from '../lib/days.js'
import { isPageSection } from './articleVersions.js'
import { citedTextSchema, researchedSourceSchema, type CitedText, type ResearchedSource } from './researchedStory.js'
import type { ArticleVersionData } from './researchPool.js'

/**
 * One Update as readers get it: its day, its note, each changed section shown on the page with its
 * earlier text, labeled by where it was in the version before (unique among an Update's changes), and
 * whether the update removed it; and the sources the note and the earlier texts cite. The public
 * contract's shape (`GET /api/stories/{slug}`, `updates`).
 */
export const publicUpdateSchema = z.object({
  date: z.string().describe('The day the story was updated, `YYYY-MM-DD` (UTC).'),
  note: citedTextSchema.describe(
    'What changed and why, cited: written by an AI model and checked against its sources, or, when that note fails its checks, a fixed line naming the sections and outlets; on the first update of a story published before it was researched, a fixed line.',
  ),
  changes: z
    .array(
      z.object({
        section: z
          .string()
          .describe('Where the section was on the page before the update: `Title`, `Story paragraph 2`, `Key quote`, `Why This Matters 1`, `Caveat 2`.'),
        before: citedTextSchema.nullable().describe('The earlier text, with the citations it carried; null for a section the update added.'),
        removed: z.boolean().describe('Whether the update removed the section rather than rewrote it.'),
      }),
    )
    .describe('Each changed section shown on the story page, with its earlier text.'),
  sources: z.array(researchedSourceSchema).describe('The sources the note and the earlier texts cite, the original article first.'),
})

export type PublicUpdate = z.infer<typeof publicUpdateSchema>

const BY_ORIGIN: Record<ResearchedSource['origin'], number> = { original: 0, source: 1, earlier: 2 }

/**
 * The Updates of a story, newest first: every version with a note that is not reverted (an update,
 * or a first pass's on a story already published), with the page's sections among its changes. An
 * undone update is reverted, and leaves the list. Its sources are found in its own version's
 * projection, which lists what the note cites, else in the version it replaced (the newest earlier
 * one not reverted), whose text the earlier texts are; a pass keeps an id meaning one source across
 * the two (`withFrozen`). A citation neither lists is left out.
 */
export function publicUpdates(
  versions: (Pick<ArticleVersionData, 'number' | 'kind' | 'status' | 'changes' | 'note' | 'research'> & { createdAt: Date })[],
): PublicUpdate[] {
  const kept = versions.filter(v => v.status !== 'reverted').sort((a, b) => b.number - a.number)
  return kept.flatMap((v, i) => {
    if (v.kind === 'legacy' || v.note === null) return []
    const replaced = kept[i + 1]
    const known = new Map([...(replaced?.research.sources ?? []), ...v.research.sources].map(s => [s.id, s]))
    const listed = (t: CitedText): CitedText => ({ ...t, citations: t.citations.filter(c => known.has(c.sourceId)) })
    const note = listed(v.note)
    const changes = v.changes
      .filter(c => isPageSection(c.section))
      .map(c => ({ section: c.from, before: c.before && listed(c.before), removed: c.after === null }))
    const cited = new Set([...note.citations, ...changes.flatMap(c => c.before?.citations ?? [])].map(c => c.sourceId))
    const sources = [...known.values()].filter(s => cited.has(s.id)).sort((a, b) => BY_ORIGIN[a.origin] - BY_ORIGIN[b.origin])
    return [{ date: utcDay(v.createdAt), note, changes, sources }]
  })
}

/** The ids of the earlier stories the Updates cite, for the read-time lookup (`forReaders`'s). */
export const updatesEarlierStoryIds = (updates: PublicUpdate[]): string[] => [
  ...new Set(updates.flatMap(u => u.sources.flatMap(s => (s.origin === 'earlier' && s.storyId ? [s.storyId] : [])))),
]

/** The Updates as readers get them now: as `forReaders` serves the article, an earlier story no longer published leaves with its citations, and the rest take their current slugs. */
export function updatesForReaders(updates: PublicUpdate[], publishedSlugs: ReadonlyMap<string, string>): PublicUpdate[] {
  return updates.map(u => {
    const slugOf = (s: ResearchedSource) => (s.origin === 'earlier' && s.storyId ? publishedSlugs.get(s.storyId) : undefined)
    const gone = new Set(u.sources.filter(s => s.origin === 'earlier' && slugOf(s) === undefined).map(s => s.id))
    const keep = (t: CitedText): CitedText => ({ ...t, citations: t.citations.filter(c => !gone.has(c.sourceId)) })
    return {
      ...u,
      note: keep(u.note),
      changes: u.changes.map(c => ({ ...c, before: c.before && keep(c.before) })),
      sources: u.sources.filter(s => !gone.has(s.id)).map(s => ({ ...s, slug: slugOf(s) ?? s.slug })),
    }
  })
}
