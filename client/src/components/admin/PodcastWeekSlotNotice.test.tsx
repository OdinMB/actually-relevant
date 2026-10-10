import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PodcastWeekSlot } from '@shared/types'
import { makePodcast } from '../../test/podcasts'
import { PodcastWeekSlotNotice, slotOutlook } from './PodcastWeekSlotNotice'

function slot(overrides: Partial<PodcastWeekSlot> = {}): PodcastWeekSlot {
  return { weekKey: '2026-W41', episode: null, fridayRun: 'create', fridayWindow: 'ahead', automaticRunEnabled: true, ...overrides }
}

describe('slotOutlook', () => {
  it('names a switched-off job before anything else', () => {
    expect(slotOutlook(slot({ automaticRunEnabled: false, fridayWindow: 'passed', fridayRun: 'advance' }))).toBe('job-off')
  })

  it('names a passed window before what the run would do', () => {
    expect(slotOutlook(slot({ fridayWindow: 'passed', fridayRun: 'create' }))).toBe('passed')
  })

  it('otherwise follows what Friday\'s run will do, while the window is ahead or open', () => {
    expect(slotOutlook(slot({ fridayWindow: 'ahead', fridayRun: 'blocked' }))).toBe('blocked')
    expect(slotOutlook(slot({ fridayWindow: 'open', fridayRun: 'create' }))).toBe('create')
  })
})

describe('PodcastWeekSlotNotice', () => {
  it('links a claimed slot to its episode', () => {
    const episode = makePodcast({ id: 'pod-9', title: 'Midweek test' })
    render(<MemoryRouter><PodcastWeekSlotNotice slot={slot({ episode, fridayRun: 'waiting-for-person' })} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Midweek test' })).toHaveAttribute('href', '/admin/podcasts/pod-9')
  })

  it('links to the Jobs page while the automatic run is off', () => {
    render(<MemoryRouter><PodcastWeekSlotNotice slot={slot({ automaticRunEnabled: false })} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/admin/jobs')
  })
})
