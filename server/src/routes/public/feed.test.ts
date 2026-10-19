import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockStoryService = vi.hoisted(() => ({ getPublishedStories: vi.fn() }))
const mockIssueService = vi.hoisted(() => ({ getIssueBySlug: vi.fn() }))

vi.mock('../../services/story.js', () => mockStoryService)
vi.mock('../../services/issue.js', () => mockIssueService)

const { default: feedRouter } = await import('./feed.js')

const app = express()
app.use('/api/feed', feedRouter)

function story(id: string, summary: string | null) {
  return {
    id,
    slug: `story-${id}`,
    title: `AI headline ${id}`,
    sourceTitle: `Source headline ${id}`,
    summary,
    datePublished: new Date('2026-09-20T00:00:00Z'),
    dateCrawled: new Date('2026-09-19T00:00:00Z'),
    issue: { name: 'Planet & Climate', slug: 'planet-climate' },
    feed: { issue: null },
  }
}

/** Text of an XML element's content, with CDATA and entities unwrapped. */
function textOf(raw: string): string {
  return raw
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function channelDescription(xml: string): string {
  const withoutItems = xml.replace(/<item>[\s\S]*?<\/item>/g, '')
  const match = withoutItems.match(/<description>([\s\S]*?)<\/description>/)
  return textOf(match![1])
}

/** One entry per <item>: its description, or null when the item has none. */
function itemDescriptions(xml: string): (string | null)[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const match = item.match(/<description>([\s\S]*?)<\/description>/)
    return match ? textOf(match[1]) : null
  })
}

describe('RSS feeds', () => {
  it('labels the global channel and every item description as AI-generated', async () => {
    mockStoryService.getPublishedStories.mockResolvedValueOnce({
      data: [story('1', 'First summary.'), story('2', 'Second summary.')],
    })

    const res = await request(app).get('/api/feed')

    expect(res.status).toBe(200)
    expect(channelDescription(res.text)).toBe('News that matters to humanity. Written and curated by AI.')
    expect(itemDescriptions(res.text)).toEqual([
      '[AI-generated] First summary.',
      '[AI-generated] Second summary.',
    ])
  })

  it('labels the per-issue channel with the issue name and prefixes every item', async () => {
    mockIssueService.getIssueBySlug.mockResolvedValueOnce({ name: 'Planet & Climate', description: 'Old description' })
    mockStoryService.getPublishedStories.mockResolvedValueOnce({
      data: [story('3', 'Issue summary.'), story('4', null)],
    })

    const res = await request(app).get('/api/feed/planet-climate')

    expect(res.status).toBe(200)
    expect(channelDescription(res.text)).toBe(
      'Planet & Climate: news that matters to humanity. Written and curated by AI.',
    )
    // A story without a summary has no description to label
    expect(itemDescriptions(res.text)).toEqual(['[AI-generated] Issue summary.', null])
  })

  describe('minRelevance', () => {
    it('filters the global feed, names the floor in the title and caches it apart from the unfiltered feed', async () => {
      mockStoryService.getPublishedStories.mockReset()
      mockStoryService.getPublishedStories
        .mockResolvedValueOnce({ data: [story('5', 'High signal.')] })
        .mockResolvedValueOnce({ data: [story('6', 'Medium signal.')] })

      const filtered = await request(app).get('/api/feed?minRelevance=8')
      const otherFloor = await request(app).get('/api/feed?minRelevance=5')
      // Both variants now come from the cache, each under its own key
      const filteredAgain = await request(app).get('/api/feed?minRelevance=8')

      expect(filtered.status).toBe(200)
      expect(mockStoryService.getPublishedStories).toHaveBeenNthCalledWith(1, expect.objectContaining({ minRelevance: 8 }))
      expect(mockStoryService.getPublishedStories).toHaveBeenNthCalledWith(2, expect.objectContaining({ minRelevance: 5 }))
      expect(mockStoryService.getPublishedStories).toHaveBeenCalledTimes(2)
      expect(filtered.text).toContain('<title>Actually Relevant (relevance 8+)</title>')
      expect(filtered.text).toContain('/api/feed?minRelevance=8')
      expect(itemDescriptions(filtered.text)).toEqual(['[AI-generated] High signal.'])
      expect(itemDescriptions(otherFloor.text)).toEqual(['[AI-generated] Medium signal.'])
      expect(filteredAgain.text).toBe(filtered.text)
      // The unfiltered feed was cached by the first test; a filtered one never replaces it
      const unfiltered = await request(app).get('/api/feed')
      expect(itemDescriptions(unfiltered.text)).toEqual([
        '[AI-generated] First summary.',
        '[AI-generated] Second summary.',
      ])
    })

    it('filters a per-issue feed', async () => {
      mockStoryService.getPublishedStories.mockReset()
      mockIssueService.getIssueBySlug.mockResolvedValueOnce({ name: 'Planet & Climate' })
      mockStoryService.getPublishedStories.mockResolvedValueOnce({ data: [story('7', 'Issue high signal.')] })

      const res = await request(app).get('/api/feed/planet-climate?minRelevance=7')

      expect(res.status).toBe(200)
      expect(mockStoryService.getPublishedStories).toHaveBeenCalledWith(
        expect.objectContaining({ issueSlug: 'planet-climate', minRelevance: 7 }),
      )
      expect(itemDescriptions(res.text)).toEqual(['[AI-generated] Issue high signal.'])
    })

    it.each(['0', '11', 'abc'])('rejects minRelevance=%s with a 400', async (value) => {
      mockStoryService.getPublishedStories.mockReset()
      const res = await request(app).get(`/api/feed?minRelevance=${value}`)
      expect(res.status).toBe(400)
      expect(res.body.details.fieldErrors.minRelevance).toEqual(['Must be a whole number from 1 to 10'])
      expect(mockStoryService.getPublishedStories).not.toHaveBeenCalled()
    })
  })
})
