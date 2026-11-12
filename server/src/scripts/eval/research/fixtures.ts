/**
 * The research measurement's inputs, sampled once through the read-only session (`readOnlyDb.ts`):
 * the newest published stories, loaded with production's research loader (`researchStoriesByIds`:
 * the full-assessment input, the fields published today, and the own-corpus material). SELECT
 * only, as a tagged `$queryRaw` template, so this module needs no value import of the Prisma client.
 */
import { researchStoriesByIds, type ResearchDb, type ResearchStory } from '../../../services/researchInput.js'
import type { ReadOnlyDb } from '../readOnlyDb.js'

export type { EarlierStory, ResearchDb, ResearchStory, SourceText } from '../../../services/researchInput.js'

export interface ResearchFixtures {
  version: 1
  createdAt: string
  /** The newest `date_published` in the copy: the sample is the `size` stories published last. */
  anchor: string
  size: number
  dbClass: 'local' | 'remote'
  readOnlyMode: 'session' | 'transaction'
  stories: ResearchStory[]
  shortfalls: string[]
}

/** The newest published stories and their own-corpus material, in publication order (newest first). */
export async function sampleResearchStories(db: ResearchDb, size: number): Promise<{ stories: ResearchStory[]; shortfalls: string[] }> {
  const sample = await db.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM stories s
    WHERE s.status = 'published' AND s.date_published IS NOT NULL AND s.title IS NOT NULL AND s.summary IS NOT NULL AND s.relevance IS NOT NULL
    ORDER BY s.date_published DESC, s.id
    LIMIT ${size}`
  const stories = await researchStoriesByIds(
    db,
    sample.map(s => s.id),
  )
  return { stories, shortfalls: stories.length < size ? [`${stories.length} of ${size} published stories`] : [] }
}

export async function loadResearchFixtures(db: ReadOnlyDb, size: number): Promise<ResearchFixtures> {
  const { stories, shortfalls } = await db.read(q => sampleResearchStories(q, size))
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    anchor: stories[0]?.datePublished ?? new Date().toISOString(),
    size,
    dbClass: db.dbClass,
    readOnlyMode: db.mode,
    stories,
    shortfalls,
  }
}
