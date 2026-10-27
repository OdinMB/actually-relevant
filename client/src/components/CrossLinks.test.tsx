import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NewsletterCrossLink, PodcastCrossLink, StoryNewsletterLine } from './CrossLinks'
import { TEXT_LINK } from '../lib/control-classes'
import { focusRingProblems } from '../test/classes'

function renderLines() {
  return render(
    <MemoryRouter>
      <PodcastCrossLink />
      <NewsletterCrossLink />
      <StoryNewsletterLine />
    </MemoryRouter>,
  )
}

/** Every control in the three lines, by accessible name. */
const CONTROLS = [
  ['link', 'Try the weekly podcast'],
  ['button', 'Get the weekly newsletter'],
  ['link', 'read past issues'],
  ['button', 'Subscribe to the newsletter'],
] as const

describe('CrossLinks', () => {
  it.each(CONTROLS)('%s "%s" keeps its name and shows only the brand ring, on keyboard focus', (role, name) => {
    renderLines()
    const control = screen.getByRole(role, { name })
    expect(focusRingProblems(control)).toEqual([])
  })

  it.each(CONTROLS)('%s "%s" uses the shared in-sentence link style', (role, name) => {
    renderLines()
    expect(screen.getByRole(role, { name })).toHaveClass(...TEXT_LINK.split(' '))
  })
})

describe('focusRingProblems', () => {
  const el = (className: string) => {
    const a = document.createElement('a')
    a.className = className
    return a
  }

  it('flags a ring the browser outline draws beside, a missing ring, and a ring on mouse focus', () => {
    expect(focusRingProblems(el('focus-visible:ring-2 focus-visible:ring-brand-500'))).toEqual(['no focus-visible:outline-none'])
    expect(focusRingProblems(el('focus-visible:outline-none'))).toEqual(['no focus-visible:ring-2', 'no focus-visible:ring-brand-500'])
    expect(focusRingProblems(el('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus:ring-2'))).toEqual([
      'focus:ring-2 shows on a mouse click too',
    ])
    expect(focusRingProblems(el('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'))).toEqual([])
  })
})
