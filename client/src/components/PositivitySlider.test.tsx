import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PositivityProvider, parseMixParam } from '../contexts/PositivityContext'
import { MoodDialPanel } from './PositivitySlider'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.search}</div>
}

function renderDial(url = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PositivityProvider>
        <MoodDialPanel />
        <LocationProbe />
      </PositivityProvider>
    </MemoryRouter>,
  )
}

const slider = () => screen.getByRole('slider', { name: 'Mix of news, from heavy to uplifting' })

describe('MoodDialPanel', () => {
  beforeEach(() => localStorage.clear())

  it('says what the slider sets and shows the current mix', () => {
    renderDial()
    expect(screen.getByText('Mix of news:')).toBeInTheDocument()
    expect(screen.getByText('Balanced mix')).toBeInTheDocument()
  })

  it('updates the visible mix and the announced value as the slider moves', () => {
    renderDial()
    fireEvent.change(slider(), { target: { value: '100' } })
    expect(screen.getByText('Only uplifting')).toBeInTheDocument()
    expect(slider()).toHaveAttribute('aria-valuetext', 'Only uplifting')
  })

  it('takes the mix from the ?mix= link over the stored preference', () => {
    localStorage.setItem('ar-positivity', '0')
    renderDial('/?mix=mostly-uplifting')
    expect(slider()).toHaveAttribute('aria-valuetext', 'Mostly uplifting')
    expect(localStorage.getItem('ar-positivity')).toBe('75')
  })

  it('falls back to the stored preference when ?mix= is not recognized', () => {
    localStorage.setItem('ar-positivity', '25')
    renderDial('/?mix=nonsense')
    expect(slider()).toHaveAttribute('aria-valuetext', 'Mostly heavy')
  })

  it('writes the mix into the address as the slider moves, keeping other parameters', () => {
    renderDial('/?q=climate')
    fireEvent.change(slider(), { target: { value: '0' } })
    expect(screen.getByTestId('location')).toHaveTextContent('?q=climate&mix=heavy')
  })
})

describe('parseMixParam', () => {
  it('reads the named positions and the numbers 0 to 100', () => {
    expect(parseMixParam('heavy')).toBe(0)
    expect(parseMixParam('Balanced')).toBe(50)
    expect(parseMixParam('uplifting')).toBe(100)
    expect(parseMixParam('75')).toBe(75)
    expect(parseMixParam('60')).toBe(50)
  })

  it('rejects missing, out-of-range and unknown values', () => {
    expect(parseMixParam(null)).toBeNull()
    expect(parseMixParam('101')).toBeNull()
    expect(parseMixParam('-5')).toBeNull()
    expect(parseMixParam('happy')).toBeNull()
  })
})
