import { describe, it, expect } from 'vitest'
import { sampleResearchStories, type ResearchDb } from './fixtures.js'

// The loader's assembly is services/researchInput.test.ts's; this is the eval's sampling around it.

const day = (d: string) => new Date(`${d}T08:00:00Z`)
const storyRow = (id: string) => ({
  id,
  slug: null,
  source_title: id,
  source_content: id,
  source_url: `https://${id}.example/a`,
  source_date_published: null,
  date_crawled: day('2026-11-11'),
  date_published: day('2026-11-12'),
  emotion_tag: null,
  title_label: null,
  title: id,
  summary: id,
  relevance_reasons: null,
  antifactors: null,
  relevance: 6,
  relevance_calculation: null,
  quote: null,
  quote_attribution: null,
  marketing_blurb: null,
  feed_title: 'feed',
  feed_display_title: null,
  feed_language: 'en',
  issue_id: null,
  issue_factors: null,
  issue_antifactors: null,
  issue_ratings: null,
  feed_issue_factors: '',
  feed_issue_antifactors: '',
  feed_issue_ratings: '',
})

/** The sample query answers the newest-first ids; the loader's story query answers rows in any order. */
function fakeDb(sampleIds: string[], loaded: string[]): ResearchDb & { sizes: unknown[] } {
  const sizes: unknown[] = []
  return {
    sizes,
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      const sql = query.join('?')
      if (sql.includes('ORDER BY s.date_published DESC')) {
        sizes.push(values[0])
        return sampleIds.map(id => ({ id })) as T
      }
      if (sql.includes('s.status::text = ANY')) return [...loaded].sort().map(storyRow) as T
      return [] as T
    },
  }
}

describe('sampleResearchStories', () => {
  it('asks for the sample size and keeps the newest-first order', async () => {
    const db = fakeDb(['b', 'a'], ['a', 'b'])
    const { stories, shortfalls } = await sampleResearchStories(db, 2)
    expect(db.sizes).toEqual([2])
    expect(stories.map(s => s.id)).toEqual(['b', 'a'])
    expect(shortfalls).toEqual([])
  })

  it('reports a short sample', async () => {
    expect((await sampleResearchStories(fakeDb(['a'], ['a']), 3)).shortfalls).toEqual(['1 of 3 published stories'])
    expect(await sampleResearchStories(fakeDb([], []), 3)).toEqual({ stories: [], shortfalls: ['0 of 3 published stories'] })
  })
})
