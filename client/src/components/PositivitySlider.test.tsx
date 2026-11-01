import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PositivityProvider } from '../contexts/PositivityContext'
import { MoodDialPanel } from './PositivitySlider'

function renderDial() {
  return render(
    <PositivityProvider>
      <MoodDialPanel />
    </PositivityProvider>,
  )
}

describe('MoodDialPanel', () => {
  beforeEach(() => localStorage.clear())

  it('says what the slider sets and shows the current mix', () => {
    renderDial()
    expect(screen.getByText('Mix of news:')).toBeInTheDocument()
    expect(screen.getByText('Balanced mix')).toBeInTheDocument()
  })

  it('updates the visible mix and the announced value as the slider moves', () => {
    renderDial()
    const slider = screen.getByRole('slider', { name: 'Mix of news, from heavy to uplifting' })
    fireEvent.change(slider, { target: { value: '100' } })
    expect(screen.getByText('Only uplifting')).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuetext', 'Only uplifting')
  })
})
