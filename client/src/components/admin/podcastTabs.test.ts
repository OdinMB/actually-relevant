import { describe, it, expect } from 'vitest'
import { makePodcast } from '../../test/podcasts'
import { PODCAST_TABS, defaultTab, resolveTab, tabState } from './podcastTabs'

const states = (overrides: Parameters<typeof makePodcast>[0]) => {
  const podcast = makePodcast(overrides)
  return PODCAST_TABS.map(def => tabState(podcast, def))
}

describe('tabState', () => {
  it('locks the tabs whose stage is not reached yet', () => {
    expect(states({ stage: 'created', mode: null, awaitingReview: false })).toEqual(['next', 'locked', 'locked'])
  })

  it('marks the step a run works toward as running', () => {
    expect(states({ stage: 'created', inProgress: true, awaitingReview: false })).toEqual(['running', 'locked', 'locked'])
    expect(states({ stage: 'scripted', inProgress: true, awaitingReview: false })).toEqual(['done', 'done', 'running'])
    expect(states({ stage: 'voiced', inProgress: true, awaitingReview: false })).toEqual(['done', 'done', 'running'])
  })

  it('marks the step waiting for a person as review', () => {
    expect(states({ stage: 'selected', awaitingReview: true })).toEqual(['review', 'next', 'locked'])
    expect(states({ stage: 'scripted', awaitingReview: true })).toEqual(['done', 'review', 'next'])
  })

  it('marks the step a failed or blocked run stopped before as error', () => {
    expect(states({ stage: 'scripted', awaitingReview: false, lastError: 'tts down' })).toEqual(['done', 'done', 'error'])
    expect(states({ stage: 'selected', awaitingReview: false, blockedAt: '2026-10-10T07:00:00.000Z' })).toEqual(['done', 'error', 'locked'])
  })

  it('marks every step done once ready', () => {
    expect(states({ stage: 'ready', awaitingReview: false })).toEqual(['done', 'done', 'done'])
  })
})

describe('defaultTab', () => {
  it('opens the tab that needs attention before the next step', () => {
    expect(defaultTab(makePodcast({ stage: 'selected', awaitingReview: true }))).toBe('stories')
    expect(defaultTab(makePodcast({ stage: 'scripted', awaitingReview: true }))).toBe('script')
    expect(defaultTab(makePodcast({ stage: 'selected', inProgress: true, awaitingReview: false }))).toBe('script')
    expect(defaultTab(makePodcast({ stage: 'scripted', awaitingReview: false, lastError: 'x' }))).toBe('audio')
  })

  it('opens the next step at rest, and the last tab once everything is done', () => {
    expect(defaultTab(makePodcast({ stage: 'created', mode: null, awaitingReview: false }))).toBe('stories')
    expect(defaultTab(makePodcast({ stage: 'selected', mode: 'automated', awaitingReview: false }))).toBe('script')
    expect(defaultTab(makePodcast({ stage: 'ready', awaitingReview: false }))).toBe('audio')
  })
})

describe('resolveTab', () => {
  const scripted = makePodcast({ stage: 'scripted', awaitingReview: true })

  it('keeps the tab named in the URL when it is open', () => {
    expect(resolveTab('stories', scripted)).toBe('stories')
    expect(resolveTab('audio', scripted)).toBe('audio')
  })

  it('falls back to the current stage for an unknown or locked tab', () => {
    expect(resolveTab('bogus', scripted)).toBe('script')
    expect(resolveTab(null, scripted)).toBe('script')
    expect(resolveTab('audio', makePodcast({ stage: 'selected' }))).toBe('stories')
  })
})
