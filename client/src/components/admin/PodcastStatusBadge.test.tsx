import { describe, it, expect } from 'vitest'
import { podcastPublication } from './PodcastStatusBadge'

describe('podcastPublication', () => {
  it('tells a listed episode, a taken-down one and a never-published one apart', () => {
    expect(podcastPublication({ status: 'published', publishedAt: '2026-10-01T06:00:00Z' })).toBe('published')
    expect(podcastPublication({ status: 'draft', publishedAt: '2026-10-01T06:00:00Z' })).toBe('unpublished')
    expect(podcastPublication({ status: 'draft', publishedAt: null })).toBe('draft')
  })
})
