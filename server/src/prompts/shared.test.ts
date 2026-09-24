import { describe, it, expect } from 'vitest'
import { formatArticlesBlock, type StoryForPrompt } from './shared.js'

function latinStory(i: number): StoryForPrompt {
  return { id: `latin-${i}`, title: `Title ${i}`, content: `Body of article ${i} in plain English.` }
}

function hanStory(i: number): StoryForPrompt {
  return { id: `han-${i}`, title: `标题 ${i}`, content: `这是第${i}篇文章的正文。` }
}

function articleIds(block: string): string[] {
  return [...block.matchAll(/Article ID: (\S+)/g)].map(m => m[1])
}

describe('formatArticlesBlock', () => {
  it('renders all 10 articles of a full Latin-script batch', () => {
    const stories = Array.from({ length: 10 }, (_, i) => latinStory(i + 1))
    expect(articleIds(formatArticlesBlock(stories))).toHaveLength(10)
  })

  it('renders every article when the batch contains Han-script text', () => {
    const stories = [
      ...Array.from({ length: 6 }, (_, i) => latinStory(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => hanStory(i + 1)),
    ]
    expect(articleIds(formatArticlesBlock(stories))).toHaveLength(10)
  })

  it('truncates each article body to contentMaxLength', () => {
    const block = formatArticlesBlock([{ id: 'a', title: 'T', content: 'x'.repeat(50) }], 20)
    expect(block).toContain(`${'x'.repeat(20)} ...`)
    expect(block).not.toContain('x'.repeat(21))
  })

  it('preserves input order', () => {
    const stories = [hanStory(1), latinStory(2), latinStory(3), hanStory(4)]
    expect(articleIds(formatArticlesBlock(stories))).toEqual(['han-1', 'latin-2', 'latin-3', 'han-4'])
  })
})
