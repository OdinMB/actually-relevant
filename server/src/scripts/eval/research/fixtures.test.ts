import { describe, it, expect } from 'vitest'
import { config } from '../../../config.js'
import { CLUSTER_MEMBERS_PER_STORY, sampleResearchStories, type ResearchDb } from './fixtures.js'
import { SOURCE_TEXT_MAX_CHARS } from './filter.js'

const day = (d: string) => new Date(`${d}T08:00:00Z`)
const article = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  source_title: `${id} source title`,
  source_content: `${id} `.repeat(2000),
  source_url: `https://${id}.example/a`,
  source_date_published: day('2026-11-10'),
  date_crawled: day('2026-11-11'),
  feed_title: `${id} feed`,
  feed_display_title: null,
  feed_language: 'en',
  ...over,
})
const sampleRow = (id: string, over: Record<string, unknown> = {}) => ({
  ...article(id),
  slug: `${id}-slug`,
  date_published: day('2026-11-12'),
  emotion_tag: 'calm',
  title_label: 'Label',
  title: `${id} title`,
  summary: `${id} summary`,
  relevance_reasons: '- why',
  antifactors: '- caveat',
  relevance: 6,
  relevance_calculation: '- calc',
  quote: 'q',
  quote_attribution: 'a',
  marketing_blurb: 'b',
  issue_id: null,
  issue_factors: null,
  issue_antifactors: null,
  issue_ratings: null,
  feed_issue_factors: 'feed factors',
  feed_issue_antifactors: 'feed antifactors',
  feed_issue_ratings: 'feed ratings',
  ...over,
})

/** Answers each of the module's four queries by a clause only that query has. */
function fakeDb(rows: { sample: unknown[]; members?: unknown[]; neighbours?: unknown[]; earlier?: unknown[] }): ResearchDb & { sizes: unknown[] } {
  const sizes: unknown[] = []
  return {
    sizes,
    async $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      const sql = query.join('?')
      if (sql.includes('ORDER BY s.date_published DESC')) {
        sizes.push(values[0])
        return rows.sample as T
      }
      if (sql.includes('m.cluster_id = src.cluster_id')) return (rows.members ?? []) as T
      if (sql.includes("interval '14 days'")) return (rows.neighbours ?? []) as T
      if (sql.includes("interval '12 months'")) return (rows.earlier ?? []) as T
      throw new Error(`unexpected query: ${sql}`)
    },
  }
}

describe('sampleResearchStories', () => {
  it('asks for the sample size and keeps the newest-first order', async () => {
    const db = fakeDb({ sample: [sampleRow('b'), sampleRow('a')] })
    const { stories, shortfalls } = await sampleResearchStories(db, 2)
    expect(db.sizes).toEqual([2])
    expect(stories.map(s => s.id)).toEqual(['b', 'a'])
    expect(shortfalls).toEqual([])
  })

  it("builds the assessment input from the story's own issue, else its feed's, with the content cut", async () => {
    const own = sampleRow('own', { issue_id: 'i1', issue_factors: 'own factors', issue_antifactors: 'own anti', issue_ratings: 'own ratings' })
    const { stories } = await sampleResearchStories(fakeDb({ sample: [own, sampleRow('feed')] }), 2)
    expect(stories[0]?.assess.guidelines).toEqual({ factors: 'own factors', antifactors: 'own anti', ratings: 'own ratings' })
    expect(stories[1]?.assess.guidelines).toEqual({ factors: 'feed factors', antifactors: 'feed antifactors', ratings: 'feed ratings' })
    expect(stories[0]?.assess.content).toHaveLength(config.assess.contentMaxLength)
    expect(stories[0]?.original.content).toHaveLength(SOURCE_TEXT_MAX_CHARS)
    expect(stories[0]?.assess.emotionTag).toBe('calm')
  })

  it('groups cluster members, neighbours and earlier stories under their story, capping members', async () => {
    const members = Array.from({ length: CLUSTER_MEMBERS_PER_STORY + 2 }, (_, i) => ({ story_id: 'a', ...article(`m${i}`) }))
    const neighbours = [{ story_id: 'b', ...article('n1', { feed_display_title: 'Display' }), title: 'n1 title', summary: 'n1 summary', distance: '0.12' }]
    const earlier = [
      {
        story_id: 'a',
        id: 'e1',
        slug: 'e1-slug',
        title: 'e1 title',
        title_label: null,
        summary: 'e1 summary',
        relevance_summary: null,
        relevance_reasons: '- e1 why',
        date_published: day('2026-05-01'),
        distance: 0.3,
      },
    ]
    const { stories } = await sampleResearchStories(fakeDb({ sample: [sampleRow('a'), sampleRow('b')], members, neighbours, earlier }), 2)
    const [a, b] = stories
    expect(a?.clusterMembers.map(m => m.storyId)).toEqual(members.slice(0, CLUSTER_MEMBERS_PER_STORY).map(m => m.id))
    expect(a?.earlier).toEqual([
      {
        id: 'e1',
        slug: 'e1-slug',
        title: 'e1 title',
        titleLabel: null,
        summary: 'e1 summary',
        relevanceSummary: '',
        whyItMatters: '- e1 why',
        datePublished: '2026-05-01T08:00:00.000Z',
        distance: 0.3,
      },
    ])
    expect(a?.neighbours).toEqual([])
    expect(b?.neighbours).toEqual([
      expect.objectContaining({
        storyId: 'n1',
        outlet: 'Display',
        assessed: { title: 'n1 title', summary: 'n1 summary' },
        distance: 0.12,
        datePublished: '2026-11-10T08:00:00.000Z',
      }),
    ])
    expect(b?.clusterMembers).toEqual([])
  })

  it('reports a short sample, and asks nothing more of an empty one', async () => {
    expect((await sampleResearchStories(fakeDb({ sample: [sampleRow('a')] }), 3)).shortfalls).toEqual(['1 of 3 published stories'])
    expect(await sampleResearchStories(fakeDb({ sample: [] }), 3)).toEqual({ stories: [], shortfalls: ['0 of 3 published stories'] })
  })
})
