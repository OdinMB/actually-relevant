import { describe, it, expect } from 'vitest'
import { makePodcast, makeStandalonePodcast } from '../../test/podcasts'
import { nextAction, runVoices } from './podcastRun'

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
