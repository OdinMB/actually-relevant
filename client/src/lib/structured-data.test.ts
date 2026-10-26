import { describe, it, expect } from 'vitest'
import indexHtml from '../../index.html?raw'
import { buildArticleSchema, buildPodcastEpisodeSchema, toJsonLd } from './structured-data'
import { makeStory } from '../test/stories'

describe('buildArticleSchema', () => {
  it('points machines to the page that explains the AI process, and keeps the Organization author', () => {
    const schema = buildArticleSchema(makeStory())
    expect(schema.publishingPrinciples).toBe('https://actuallyrelevant.news/methodology')
    expect(schema.author).toEqual({ '@type': 'Organization', name: 'Actually Relevant', url: 'https://actuallyrelevant.news' })
  })
})

describe('buildPodcastEpisodeSchema', () => {
  const episode = {
    id: 'ep-1',
    title: 'W42',
    summary: 'S.',
    publishedAt: '2026-10-12T07:30:00.000Z',
    durationSec: 372,
    audioUrl: 'https://audio.example/e.mp3',
  }

  it('states the duration as ISO 8601 and points at the transcript page and the show', () => {
    const schema = buildPodcastEpisodeSchema(episode)
    expect(schema.timeRequired).toBe('PT6M12S')
    expect(schema.url).toBe('https://actuallyrelevant.news/podcast/ep-1/transcript')
    expect(schema.partOfSeries.url).toBe('https://actuallyrelevant.news/podcast')
  })

  it('leaves the duration out when it is not known', () => {
    expect(buildPodcastEpisodeSchema({ ...episode, durationSec: null })).not.toHaveProperty('timeRequired')
  })
})

describe('app shell author metadata', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html')

  it('names the project, not a person, as the author', () => {
    expect(doc.querySelector('meta[name="author"]')?.getAttribute('content')).toBe('Actually Relevant')
  })

  it('carries no article:author, which only story pages set (their Helmet, and the backend for crawlers)', () => {
    expect(doc.querySelector('meta[property="article:author"]')).toBeNull()
  })
})

describe('toJsonLd', () => {
  const hostile = { headline: '</script><script>alert(1)</script> & more', note: 'line\u2028sep\u2029para' }

  it('leaves no character that can end the script element or break a JS parser', () => {
    const out = toJsonLd(hostile)
    expect(out).not.toMatch(/[<>&\u2028\u2029]/)
    expect(out).toContain('\\u003c/script\\u003e')
  })

  it('parses back to the same value', () => {
    expect(JSON.parse(toJsonLd(hostile))).toEqual(hostile)
  })
})
