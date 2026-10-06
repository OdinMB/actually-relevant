import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { makePodcast, renderInAdmin } from '../../test/podcasts'

const mockApi = vi.hoisted(() => ({ usage: vi.fn(), active: vi.fn() }))
vi.mock('../../lib/admin-api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/admin-api')>()),
  adminApi: { podcasts: mockApi },
}))

import { PodcastVoiceConfirm, voiceCostText } from './PodcastVoiceConfirm'

beforeEach(() => {
  vi.clearAllMocks()
  mockApi.usage.mockResolvedValue(USAGE)
  mockApi.active.mockResolvedValue([])
})

const USAGE = { monthToDateChars: 10800, monthlyCap: 32000, typicalEpisodeChars: 4900, maxEpisodeChars: 6200 }

describe('voiceCostText', () => {
  it('states the estimate, the credits at one per character, and the month against the cap', () => {
    const text = voiceCostText(makePodcast({ ttsCharsEstimate: 5432 }), USAGE)
    expect(text).toContain('5,432 characters')
    expect(text).toContain('5,432 credits')
    expect(text).toContain('10,800 of 32,000')
  })

  it('without a script yet, states a typical episode and its ceiling instead of the script', () => {
    const text = voiceCostText(makePodcast({ ttsCharsEstimate: null }), USAGE)
    expect(text).toContain('4,900 characters')
    expect(text).toContain('4,900 credits')
    expect(text).toContain('6,200')
    expect(text).toContain('10,800 of 32,000')
  })

  it('says no credits are spent in a dry run, and when no figure is known yet', () => {
    expect(voiceCostText(makePodcast({ dryRun: true }), undefined)).toMatch(/no credits/)
    expect(voiceCostText(makePodcast({ ttsCharsEstimate: null }), undefined)).toMatch(/not known/)
  })
})

describe('PodcastVoiceConfirm', () => {
  it('shows the figures and calls nothing but close on cancel', async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    renderInAdmin(<PodcastVoiceConfirm open podcast={makePodcast({ ttsCharsEstimate: 5432 })} title="Voice it?" confirmLabel="Voice it" onClose={onClose} onConfirm={onConfirm} />)
    expect(await screen.findByText(/10,800 of 32,000/)).toBeTruthy()
    expect(screen.getByText(/5,432 characters/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
