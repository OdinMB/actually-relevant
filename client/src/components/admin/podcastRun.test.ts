import { describe, it, expect } from 'vitest'
import { makePodcast, makeStandalonePodcast } from '../../test/podcasts'
import { nextAction, runVoices, stepRunState } from './podcastRun'

describe('nextAction', () => {
  it('offers the mode choice only for a new episode without a mode', () => {
    expect(nextAction(makePodcast({ stage: 'created', mode: null, awaitingReview: false }))).toBe('choose-mode')
    expect(nextAction(makePodcast({ stage: 'created', mode: 'automated', awaitingReview: false, lastError: 'x' }))).toBe('resume')
  })

  it('offers approval at a review stop and Resume after a failure', () => {
    expect(nextAction(makePodcast({ stage: 'selected' }))).toBe('approve-stories')
    expect(nextAction(makePodcast({ stage: 'scripted' }))).toBe('approve-script')
    expect(nextAction(makePodcast({ stage: 'scripted', awaitingReview: false, lastError: 'tts down' }))).toBe('resume')
  })

  it('offers nothing while a run works, once ready, published or legacy', () => {
    expect(nextAction(makePodcast({ inProgress: true }))).toBeNull()
    expect(nextAction(makePodcast({ stage: 'ready' }))).toBeNull()
    expect(nextAction(makePodcast({ status: 'published' }))).toBeNull()
    expect(nextAction(makePodcast({ stage: 'legacy' }))).toBeNull()
  })

  it('asks a person to choose a standalone episode\'s stories at created, whatever its mode', () => {
    expect(nextAction(makeStandalonePodcast())).toBe('choose-stories')
    expect(nextAction(makeStandalonePodcast({ mode: 'interactive' }))).toBe('choose-stories')
    expect(nextAction(makeStandalonePodcast({ mode: 'automated', lastError: 'x' }))).toBe('choose-stories')
    expect(nextAction(makeStandalonePodcast({ stage: 'selected', mode: 'interactive', awaitingReview: true }))).toBe('approve-stories')
  })
})

describe('runVoices', () => {
  it('is true from the script on, whatever the mode', () => {
    expect(runVoices(makePodcast({ stage: 'scripted', mode: 'interactive' }))).toBe(true)
  })

  it('is true for an automated run from created or selected, given or stored', () => {
    expect(runVoices(makePodcast({ stage: 'created', mode: null }), 'automated')).toBe(true)
    expect(runVoices(makePodcast({ stage: 'selected', mode: 'interactive' }), 'automated')).toBe(true)
    expect(runVoices(makePodcast({ stage: 'selected', mode: 'automated' }))).toBe(true)
  })

  it('is false for an interactive run before the script, which stops at the next review', () => {
    expect(runVoices(makePodcast({ stage: 'created', mode: null }), 'interactive')).toBe(false)
    expect(runVoices(makePodcast({ stage: 'selected', mode: 'interactive' }))).toBe(false)
  })
})

describe('stepRunState', () => {
  const atStories = makePodcast({ stage: 'selected' })

  it('offers Write script at the stories review, and Voice script at the script review', () => {
    expect(stepRunState(atStories, 'write-script', false)).toEqual({ reason: null })
    expect(stepRunState(makePodcast(), 'voice-script', false)).toEqual({ reason: null })
  })

  it('gives a reason until the step before it is done', () => {
    expect(stepRunState(makeStandalonePodcast(), 'write-script', false)?.reason).toMatch(/stories/i)
    expect(stepRunState(atStories, 'voice-script', false)?.reason).toMatch(/script/i)
  })

  it('gives a reason while edits are unsaved or a run works', () => {
    expect(stepRunState(atStories, 'write-script', true)?.reason).toMatch(/Save or discard/)
    expect(stepRunState(makePodcast(), 'voice-script', true)?.reason).toMatch(/Save or discard/)
    expect(stepRunState(makePodcast({ inProgress: true, awaitingReview: false }), 'voice-script', false)?.reason).toMatch(/run is working/)
  })

  it('points an automated episode that stopped to Resume instead', () => {
    const stopped = makePodcast({ stage: 'selected', mode: 'automated', awaitingReview: false, lastError: 'x' })
    expect(stepRunState(stopped, 'write-script', false)?.reason).toMatch(/Resume/)
  })

  it('is hidden once the step\'s work exists, and on a published or legacy episode', () => {
    expect(stepRunState(makePodcast(), 'write-script', false)).toBeNull()
    expect(stepRunState(makePodcast({ stage: 'voiced' }), 'voice-script', false)).toBeNull()
    expect(stepRunState(makePodcast({ stage: 'ready' }), 'voice-script', false)).toBeNull()
    expect(stepRunState(makePodcast({ stage: 'selected', publishedAt: '2026-10-12T07:00:00.000Z' }), 'write-script', false)).toBeNull()
    expect(stepRunState(makePodcast({ stage: 'legacy' }), 'voice-script', false)).toBeNull()
  })
})
