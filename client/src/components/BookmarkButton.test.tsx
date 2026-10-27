import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BookmarkButton from './BookmarkButton'
import { isBox, phoneAfterReach, sizeByBreakpoint } from '../test/classes'

beforeEach(() => {
  localStorage.clear()
})

describe('BookmarkButton', () => {
  it('keeps its accessible names: "Bookmark story", then "Remove bookmark" once saved', () => {
    render(<BookmarkButton slug="a-story" />)
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark story' }))
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument()
  })

  it('draws the unsaved icon in a grey that meets 3:1, never neutral-300 or -400', () => {
    render(<BookmarkButton slug="a-story" />)
    const button = screen.getByRole('button', { name: 'Bookmark story' })
    expect([...button.classList].filter(c => /^text-neutral-[1-4]00$/.test(c))).toEqual([])
  })
})

describe('BookmarkButton in a row of actions', () => {
  it('is a 44px square box on phones and a 24px one from md up', () => {
    render(<BookmarkButton slug="a-story" placement="row" />)
    const button = screen.getByRole('button', { name: 'Bookmark story' })
    expect(isBox(button)).toBe(true)
    for (const axis of ['w', 'h'] as const) {
      const sizes = sizeByBreakpoint(button, axis)
      expect(sizes.get(''), `${axis} on phones`).toBeGreaterThanOrEqual(44)
      expect(sizes.get('md'), `${axis} from md up`).toBeGreaterThanOrEqual(24)
    }
  })
})

describe('BookmarkButton in a card corner', () => {
  it.each(['sm', 'md'] as const)('%s: keeps its box and reaches a 44px square hit area on phones', size => {
    render(<BookmarkButton slug="a-story" size={size} />)
    const button = screen.getByRole('button', { name: 'Bookmark story' })
    const width = sizeByBreakpoint(button, 'w').get('')!
    const height = sizeByBreakpoint(button, 'h').get('')!
    expect(width).toBeGreaterThanOrEqual(24)
    expect(height).toBeGreaterThanOrEqual(24)
    // The invisible ::after carries the hit area past the box, so nothing moves
    expect(button).toHaveClass('relative', 'max-md:after:absolute')
    const reach = phoneAfterReach(button)
    expect(width + reach.left + reach.right).toBeGreaterThanOrEqual(44)
    expect(height + reach.top + reach.bottom).toBeGreaterThanOrEqual(44)
  })
})
