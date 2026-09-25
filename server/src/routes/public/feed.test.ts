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
})
