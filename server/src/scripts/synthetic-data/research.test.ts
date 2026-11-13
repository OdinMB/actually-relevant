import { describe, it, expect } from 'vitest'
import { buildSyntheticDataset, SYNTHETIC_ORIGIN } from './dataset.js'
import { researchedStorySchema } from '../../services/researchedStory.js'

const NOW = new Date('2026-11-12T12:00:00Z')

describe('the synthetic researched stories', () => {
  const { stories } = buildSyntheticDataset(NOW, 'http://localhost:5173')
  const researched = stories.filter(s => s.row.research)
  const byId = new Map(stories.map(s => [s.row.id, s]))

  it('gives a few published stories a researched version their page can render, and the single-source snapshot', () => {
    expect(researched.length).toBeGreaterThanOrEqual(2)
    for (const story of researched) {
      expect(story.row.status).toBe('published')
      expect(researchedStorySchema.safeParse(story.row.research).success).toBe(true)
      expect(story.row.preResearch).toMatchObject({ summary: expect.any(String), relevanceSummary: expect.any(String) })
      // The rating is never swapped, so the snapshot holds none
      expect(story.row.preResearch).not.toHaveProperty('relevance')
      // The swap nulls the relevance summary, which research does not write
      expect(story.row.relevanceSummary).toBeNull()
    }
  })

  it('cites an earlier synthetic story that is published, and only invented addresses', () => {
    for (const story of researched) {
      const research = researchedStorySchema.parse(story.row.research)
      const earlier = research.sources.filter(s => s.origin === 'earlier')
      expect(earlier.length).toBeGreaterThan(0)
      for (const s of earlier) expect(byId.get(s.storyId!)?.row.status).toBe('published')
      for (const s of research.sources) if (s.url) expect(s.url.startsWith(`${SYNTHETIC_ORIGIN}/`)).toBe(true)
    }
  })

  it('leaves every other story unresearched', () => {
    for (const story of stories.filter(s => !s.row.research)) expect(story.row.preResearch ?? null).toBeNull()
  })
})
