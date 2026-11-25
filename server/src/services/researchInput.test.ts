import { describe, it, expect } from 'vitest'
import { config } from '../config.js'
import { CLUSTER_MEMBERS_PER_STORY, researchStoriesByIds, type ResearchDb } from './researchInput.js'

// How the rows become a ResearchStory. Which rows the SQL returns (statuses, windows, clusters) is
// researchInput.db.test.ts's: no test here replays the SQL.

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
const storyRow = (id: string, over: Record<string, unknown> = {}) => ({
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

/** Answers each of the module's four queries by a clause only that query has, and counts the queries. */
function fakeDb(rows: { stories: unknown[]; members?: unknown[]; neighbours?: unknown[]; earlier?: unknown[] }): ResearchDb & { queries: number } {
  const db = {
    queries: 0,
    async $queryRaw<T>(query: TemplateStringsArray): Promise<T> {
      db.queries++
      const sql = query.join('?')
      if (sql.includes('s.status::text = ANY')) return rows.stories as T
      if (sql.includes('m.cluster_id = src.cluster_id')) return (rows.members ?? []) as T
      if (sql.includes("interval '14 days'")) return (rows.neighbours ?? []) as T
      if (sql.includes("interval '12 months'")) return (rows.earlier ?? []) as T
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  return db
}

describe('researchStoriesByIds', () => {
  it('returns the stories in the order of the ids asked for, leaving out ids that did not load', async () => {
    const stories = await researchStoriesByIds(fakeDb({ stories: [storyRow('a'), storyRow('b')] }), ['b', 'missing', 'a'])
    expect(stories.map(s => s.id)).toEqual(['b', 'a'])
  })

  it("builds the assessment input from the story's own issue, else its feed's, with the content cut", async () => {
    const own = storyRow('own', { issue_id: 'i1', issue_factors: 'own factors', issue_antifactors: 'own anti', issue_ratings: 'own ratings' })
    const stories = await researchStoriesByIds(fakeDb({ stories: [own, storyRow('feed')] }), ['own', 'feed'])
    expect(stories[0]?.assess.guidelines).toEqual({ factors: 'own factors', antifactors: 'own anti', ratings: 'own ratings' })
    expect(stories[1]?.assess.guidelines).toEqual({ factors: 'feed factors', antifactors: 'feed antifactors', ratings: 'feed ratings' })
    expect(stories[0]?.assess.content).toHaveLength(config.assess.contentMaxLength)
    expect(stories[0]?.assess.emotionTag).toBe('calm')
  })

  describe('how much of each article the extraction reads', () => {
    const { original, other } = config.research.sourceLimits
    /** Running text of whole sentences, longer than `chars`. */
    const prose = (seed: string, chars: number) =>
      Array.from({ length: Math.ceil(chars / 30) }, (_, i) => `Sentence ${i} of the ${seed} report adds a detail.`).join(' ')
    /** That `cut` is the start of `whole` up to a sentence's stop, no longer than `maxChars`, with the next sentence after it. */
    const expectCutAtSentenceEnd = (cut: string, whole: string, maxChars: number) => {
      expect(cut.length).toBeLessThanOrEqual(maxChars)
      expect(whole.startsWith(cut)).toBe(true)
      expect(whole.slice(cut.length)).toMatch(/^ Sentence \d+ of/)
    }

    it("reads the story's own article further than any other source, ending at a sentence end", async () => {
      const long = prose('own', original.textChars + 2000)
      const [s] = await researchStoriesByIds(fakeDb({ stories: [storyRow('a', { source_content: long })] }), ['a'])
      const content = s?.original.content ?? ''
      expectCutAtSentenceEnd(content, long, original.textChars)
      expect(content.length).toBeGreaterThan(other.textChars)
    })

    it("reads the story's own article whole when it fits", async () => {
      const fits = prose('own', other.textChars + 1000).slice(0, original.textChars)
      const [s] = await researchStoriesByIds(fakeDb({ stories: [storyRow('a', { source_content: fits })] }), ['a'])
      expect(s?.original.content).toBe(fits)
    })

    it("reads a cluster member's and a neighbour's article to the other sources' length, ending at a sentence end", async () => {
      const long = prose('member', original.textChars)
      const members = [{ story_id: 'a', ...article('m1', { source_content: long }) }]
      const neighbours = [{ story_id: 'a', ...article('n1', { source_content: long }), title: 'n1 title', summary: 'n1 summary', distance: 0.1 }]
      const [s] = await researchStoriesByIds(fakeDb({ stories: [storyRow('a')], members, neighbours }), ['a'])
      expectCutAtSentenceEnd(s?.clusterMembers[0]?.content ?? '', long, other.textChars)
      expectCutAtSentenceEnd(s?.neighbours[0]?.content ?? '', long, other.textChars)
    })
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
    const [a, b] = await researchStoriesByIds(fakeDb({ stories: [storyRow('a'), storyRow('b')], members, neighbours, earlier }), ['a', 'b'])
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

  it('asks nothing more when no story loads, and nothing at all for no ids', async () => {
    const empty = fakeDb({ stories: [] })
    expect(await researchStoriesByIds(empty, ['a'])).toEqual([])
    expect(empty.queries).toBe(1)
    const none = fakeDb({ stories: [] })
    expect(await researchStoriesByIds(none, [])).toEqual([])
    expect(none.queries).toBe(0)
  })
})
