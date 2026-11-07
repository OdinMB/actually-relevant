import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PodcastWeekSlot } from '@shared/types'
import { makePodcast } from '../../test/podcasts'
import { PodcastWeekSlotNotice, slotOutlook } from './PodcastWeekSlotNotice'

function slot(overrides: Partial<PodcastWeekSlot> = {}): PodcastWeekSlot {
  return {
    edition: 'full',
    weekKey: '2026-W41',
    episode: null,
    fridayRun: 'create',
    fridayWindow: 'ahead',
    automaticRunEnabled: true,
    showProblem: null,
    ...overrides,
  }
}

const CLOSED = 'Actually Uplifting is switched off: PODCAST_UPLIFTING_ENABLED is not "true" on the API service'

describe('slotOutlook', () => {
  it('names a switched-off job before anything else', () => {
    expect(slotOutlook(slot({ automaticRunEnabled: false, fridayWindow: 'passed', fridayRun: 'advance' }))).toBe('job-off')
  })

  it('names a passed window before what the run would do', () => {
    expect(slotOutlook(slot({ fridayWindow: 'passed', fridayRun: 'create' }))).toBe('passed')
  })

  it("otherwise follows what Friday's run will do, while the window is ahead or open", () => {
    expect(slotOutlook(slot({ fridayWindow: 'ahead', fridayRun: 'blocked' }))).toBe('blocked')
    expect(slotOutlook(slot({ fridayWindow: 'open', fridayRun: 'create' }))).toBe('create')
  })
})

describe('PodcastWeekSlotNotice', () => {
  it('links a claimed slot to its episode', () => {
    const episode = makePodcast({ id: 'pod-9', title: 'Midweek test' })
    render(
      <MemoryRouter>
        <PodcastWeekSlotNotice slot={slot({ episode, fridayRun: 'waiting-for-person' })} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Midweek test' })).toHaveAttribute('href', '/admin/podcasts/pod-9')
  })

  it('links to the Jobs page while the automatic run is off', () => {
    render(
      <MemoryRouter>
        <PodcastWeekSlotNotice slot={slot({ automaticRunEnabled: false })} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/admin/jobs')
  })

  describe('for Actually Uplifting', () => {
    const start = <button type="button">Start this week&apos;s Actually Uplifting episode</button>

    it('says the show is switched off and what it waits for, with no start button', () => {
      render(
        <MemoryRouter>
          <PodcastWeekSlotNotice edition="uplifting" slot={slot({ edition: 'uplifting', automaticRunEnabled: false, showProblem: CLOSED })} action={start} />
        </MemoryRouter>,
      )
      const notice = screen.getByRole('region', { name: "This week's Actually Uplifting episode" })
      expect(notice).toHaveTextContent(`${CLOSED}.`)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      // Turning the job on is refused while the show is closed, so the notice does not suggest it
      expect(screen.queryByRole('link', { name: 'Jobs' })).not.toBeInTheDocument()
    })

    it('names the show and its short-week rule once open, with its start button', () => {
      render(
        <MemoryRouter>
          <PodcastWeekSlotNotice edition="uplifting" slot={slot({ edition: 'uplifting' })} action={start} />
        </MemoryRouter>,
      )
      expect(screen.getByText('No Actually Uplifting episode for this week yet.')).toBeInTheDocument()
      expect(screen.getByText(/if the week has at least 4 uplifting stories/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: "Start this week's Actually Uplifting episode" })).toBeInTheDocument()
    })

    it('names the show when its slot could not be read', () => {
      render(
        <MemoryRouter>
          <PodcastWeekSlotNotice edition="uplifting" failed />
        </MemoryRouter>,
      )
      expect(screen.getByText("Could not check this week's Actually Uplifting episode.")).toBeInTheDocument()
    })
  })
})
