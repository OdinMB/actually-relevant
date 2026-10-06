import { describe, it, expect } from 'vitest'
import type { PodcastFixtureStory, PodcastItem } from '../fixtures.js'
import { podcastCriteria } from '../shipRules.js'
import { checkPodcastSelection, podcastEpisodeStories, podcastPool } from './podcast.js'

function story(n: number, category: string, relevance?: number, withId = true): PodcastFixtureStory {
  return {
    category, title: `Title ${n}`, summary: 's', publisher: `Pub ${n}`, relevanceReasons: `Reasons ${n}`, antifactors: 'a',
    ...(withId ? { id: `id-${n}` } : {}),
    ...(relevance !== undefined ? { relevance } : {}),
  }
}

const item = (stories: PodcastFixtureStory[]): PodcastItem => ({ id: 'recent-stories', source: 'recent-stories', stories })

describe('podcastEpisodeStories', () => {
  it('takes the most relevant story per issue first, then fills by relevance up to five', () => {
    const p = item([
      story(1, 'Planet', 6), story(2, 'Planet', 9), story(3, 'Health', 7),
      story(4, 'Science', 5), story(5, 'Threats', 4), story(6, 'Planet', 8), story(7, 'Health', 3),
    ])
    expect(podcastEpisodeStories(p).map(s => s.title)).toEqual(['Title 2', 'Title 3', 'Title 4', 'Title 5', 'Title 6'])
    expect(podcastEpisodeStories(p).map(s => s.ref)).toEqual([1, 2, 3, 4, 5])
  })

  it('reads older caches without ids or relevance in their stored order', () => {
    const p = item([story(1, 'A', undefined, false), story(2, 'B', undefined, false)])
    expect(podcastPool(p).map(s => s.id)).toEqual(['story-1', 'story-2'])
    expect(podcastEpisodeStories(p).map(s => s.whyItMatters)).toEqual(['Reasons 1', 'Reasons 2'])
  })
})

describe('checkPodcastSelection', () => {
  const p = item([story(1, 'A'), story(2, 'A'), story(3, 'B'), story(4, 'C'), story(5, 'D'), story(6, 'D')])

  it('accepts four or five valid ids that span the available issues', () => {
    const c = checkPodcastSelection(p, { selectedIds: ['id-1', 'id-3', 'id-4', 'id-5'] })
    expect(c).toMatchObject({ invalidIds: 0, countOk: true, distinctIssuesOk: true })
  })

  it('flags unknown ids, a wrong count and issues left out', () => {
    expect(checkPodcastSelection(p, { selectedIds: ['id-1', 'id-3', 'id-4', 'nope'] })).toMatchObject({ invalidIds: 1, countOk: false })
    expect(checkPodcastSelection(p, { selectedIds: ['id-1', 'id-2', 'id-3', 'id-4'] }).distinctIssuesOk).toBe(false)
  })
})

describe('podcastCriteria', () => {
  const okDialogue = { errors: [], longSentenceShare: 0.1, publisherCoverage: 1, segues: [] }
  const okSelection = { picks: ['a', 'b', 'c', 'd'], invalidIds: 0, countOk: true, distinctIssuesOk: true }
  const requiredFailing = (cs: ReturnType<typeof podcastCriteria>) => cs.filter(c => c.required && !c.pass).map(c => c.name)

  it('passes a valid dialogue and selection', () => {
    expect(requiredFailing(podcastCriteria(okDialogue, okSelection, 0))).toEqual([])
  })

  it('fails on a validation error, a missing answer or a failed call', () => {
    expect(requiredFailing(podcastCriteria({ ...okDialogue, errors: ['x'] }, okSelection, 0))).toHaveLength(1)
    expect(requiredFailing(podcastCriteria(null, null, 2))).toHaveLength(4)
  })
})
