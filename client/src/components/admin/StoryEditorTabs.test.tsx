import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StoryEditorTabs } from './StoryEditorTabs'
import { STORY_TABS, type StoryTab, type TabMark } from './storyTabs'

const NO_MARKS = Object.fromEntries(STORY_TABS.map(tab => [tab, null])) as Record<StoryTab, TabMark>
const PANELS = Object.fromEntries(STORY_TABS.map(tab => [tab, <p key={tab}>{tab} panel</p>])) as Record<StoryTab, ReactNode>

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }
}

/**
 * Where jsdom would have laid the tabs out, in the view's coordinates: the tab list's bottom edge
 * (pinned at the top of the scroll box, or in its place under the title) and the panels' top edge.
 */
function layOut({ listBottom, panelsTop }: { listBottom: number; panelsTop: number }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'tablist') return rect(listBottom - 40, listBottom)
    if (this.querySelector(':scope > [role="tabpanel"]')) return rect(panelsTop, panelsTop + 2000)
    return rect(0, 0)
  })
}

/** The admin's scroll box (`<main>`), scrolled to `top`; jsdom keeps no offset of its own. */
function scrollBox(top: number) {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  let offset = top
  Object.defineProperty(box, 'scrollTop', {
    configurable: true,
    get: () => offset,
    set: (value: number) => {
      offset = value
    },
  })
  return document.body.appendChild(box)
}

function Tabs() {
  const [tab, setTab] = useState<StoryTab>('story')
  return <StoryEditorTabs tabs={['story', 'assessment', 'source']} selected={tab} marks={NO_MARKS} onSelect={setTab} panels={PANELS} />
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StoryEditorTabs while the page is scrolled', () => {
  it('scrolls back to the top of the panels when a switch finds them under the pinned tabs', () => {
    const box = scrollBox(900)
    render(<Tabs />, { container: box })
    // Scrolled 300px past the panels' top, which sits under the list's bottom at 40
    layOut({ listBottom: 40, panelsTop: -300 })
    fireEvent.click(screen.getByRole('tab', { name: 'Assessment' }))
    expect(screen.getByRole('tab', { name: 'Assessment' })).toHaveAttribute('aria-selected', 'true')
    expect(box.scrollTop).toBe(560)
  })

  it('moves nothing on a switch while the top of the panels is in view', () => {
    const box = scrollBox(100)
    render(<Tabs />, { container: box })
    layOut({ listBottom: 140, panelsTop: 140 })
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
    expect(box.scrollTop).toBe(100)
  })

  it('moves nothing when the tabs first show, however far down the page is', () => {
    const box = scrollBox(900)
    layOut({ listBottom: 40, panelsTop: -300 })
    render(<Tabs />, { container: box })
    expect(box.scrollTop).toBe(900)
  })
})
