import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { useNoteStacking } from './noteStacking'

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function Page({ active, position }: { active: boolean; position: 'absolute' | 'static' }) {
  const ref = useRef<HTMLDivElement>(null)
  useNoteStacking(ref, active, 'v1')
  return (
    <div ref={ref}>
      <aside data-margin-note="" data-top="0" data-height="300" style={{ position }} />
      <aside data-margin-note="" data-top="120" data-height="100" style={{ position }} />
      <section data-clear-notes="" data-top="200" data-height="10" />
    </div>
  )
}

function measureFromData() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return rect(Number(this.dataset.top ?? 0), Number(this.dataset.height ?? 0))
  })
}

describe('useNoteStacking', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('moves an overlapping margin note down and pushes More context below the last note', () => {
    measureFromData()
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe
        disconnect = disconnect
      },
    )
    const { container, unmount } = render(<Page active position="absolute" />)
    const [first, second] = [...container.querySelectorAll<HTMLElement>('[data-margin-note]')]
    expect(first!.style.transform).toBe('')
    expect(second!.style.transform).toBe('translateY(196px)')
    // The last note ends at 316 + 100 = 416; the section starts at 200 and keeps a 32px gap.
    expect(container.querySelector<HTMLElement>('[data-clear-notes]')!.style.paddingTop).toBe('248px')
    expect(observe).toHaveBeenCalledTimes(3)
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('leaves the notes where they are when they sit in the column', () => {
    measureFromData()
    const { container } = render(<Page active position="static" />)
    for (const note of container.querySelectorAll<HTMLElement>('[data-margin-note]')) expect(note.style.transform).toBe('')
    expect(container.querySelector<HTMLElement>('[data-clear-notes]')!.style.paddingTop).toBe('')
  })

  it('does nothing while inactive', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    render(<Page active={false} position="absolute" />)
    expect(spy).not.toHaveBeenCalled()
  })
})
