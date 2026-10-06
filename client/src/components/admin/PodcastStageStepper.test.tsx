import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ usage: vi.fn(), active: vi.fn(), resume: vi.fn(), get: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastStageStepper, nextAction, stepStates } from './PodcastStageStepper'

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue({ monthToDateChars: 10800, monthlyCap: 32000 })
  mockApi.active.mockResolvedValue([])
  mockApi.resume.mockResolvedValue(makePodcast({ inProgress: true }))
  mockApi.get.mockResolvedValue(makePodcast())
})

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
})

describe('stepStates', () => {
  it('marks the step a run works toward as running, and the reached ones done', () => {
    expect(stepStates({ stage: 'selected', inProgress: true })).toEqual(['done', 'running', 'todo', 'todo'])
    expect(stepStates({ stage: 'selected', inProgress: false })).toEqual(['done', 'next', 'todo', 'todo'])
    expect(stepStates({ stage: 'ready', inProgress: false })).toEqual(['done', 'done', 'done', 'done'])
  })
})

describe('PodcastStageStepper', () => {
  it('shows the two mode buttons for a new episode and starts the chosen mode', async () => {
    renderInAdmin(<PodcastStageStepper podcast={makePodcast({ stage: 'created', mode: null, awaitingReview: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Interactive (review each step)' }))
    await waitFor(() => expect(mockApi.resume).toHaveBeenCalledWith('pod-1', 'interactive'))
    expect(screen.getByRole('button', { name: 'Fully automated' })).toBeTruthy()
  })

  it('shows no mode buttons once a mode is chosen', () => {
    renderInAdmin(<PodcastStageStepper podcast={makePodcast({ stage: 'selected' })} />)
    expect(screen.queryByRole('button', { name: 'Fully automated' })).toBeNull()
  })

  it('while a run works: a spinner on the running step, its activity announced, and no actions', () => {
    renderInAdmin(<PodcastStageStepper podcast={makePodcast({ stage: 'scripted', inProgress: true, awaitingReview: false, activity: 'Voicing' })} />)
    expect(screen.getAllByRole('status').some(el => el.textContent?.includes('Voicing'))).toBe(true)
    expect(screen.getByRole('list', { name: 'Production steps' }).querySelector('[aria-current="step"] svg.animate-spin')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve|Resume|Start over/ })).toBeNull()
  })

  it('asks for the cost before approving the script, and sends nothing on cancel', async () => {
    renderInAdmin(<PodcastStageStepper podcast={makePodcast({ stage: 'scripted' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve script and voice it' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockApi.resume).not.toHaveBeenCalled()
  })

  it('keeps approval disabled while the page holds unsaved edits', () => {
    renderInAdmin(<PodcastStageStepper podcast={makePodcast({ stage: 'selected' })} pendingEdits />)
    expect((screen.getByRole('button', { name: 'Approve stories and write the script' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
