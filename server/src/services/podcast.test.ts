import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/prisma.js', () => ({ default: {} }))
vi.mock('./llm.js', () => ({ getLargeLLM: vi.fn(), rateLimitDelay: vi.fn() }))

const { assemblePodcastScript } = await import('./podcast.js')

describe('assemblePodcastScript', () => {
  const stories = [{ title: 'AI headline', publisher: 'Nature', sourceUrl: 'https://example.com/a' }]

  it('opens with the fixed spoken AI notice, before anything the model wrote', () => {
    const script = assemblePodcastScript('  Welcome to the Actually Relevant Podcast.', stories)
    const [firstLine, , secondParagraph] = script.split('\n')
    expect(firstLine).toBe('This is an AI-generated voice.')
    expect(secondParagraph).toBe('Welcome to the Actually Relevant Podcast.')
  })

  it('keeps the story list with links after the generated script', () => {
    const script = assemblePodcastScript('Script body.', stories)
    expect(script.indexOf('Script body.')).toBeLessThan(script.indexOf('- AI headline\nNature | AI analysis\nhttps://example.com/a'))
  })
})
