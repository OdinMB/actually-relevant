import { describe, it, expect } from 'vitest'
import indexHtml from '../../index.html?raw'
import { buildArticleSchema } from './structured-data'
import { makeStory } from '../test/stories'

describe('buildArticleSchema', () => {
  it('points machines to the page that explains the AI process, and keeps the Organization author', () => {
    const schema = buildArticleSchema(makeStory())
    expect(schema.publishingPrinciples).toBe('https://actuallyrelevant.news/methodology')
    expect(schema.author).toEqual({ '@type': 'Organization', name: 'Actually Relevant', url: 'https://actuallyrelevant.news' })
  })
})

describe('app shell author metadata (story routes are not prerendered, so crawlers read these)', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html')

  it('names the project, not a person, as the author', () => {
    expect(doc.querySelector('meta[name="author"]')?.getAttribute('content')).toBe('Actually Relevant')
    expect(doc.querySelector('meta[property="article:author"]')?.getAttribute('content')).toBe('Actually Relevant')
  })
})
