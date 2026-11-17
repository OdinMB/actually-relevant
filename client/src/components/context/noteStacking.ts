import { useLayoutEffect, type RefObject } from 'react'

/** The space between two notes in the margin, and between the last note and the wide More context section. */
const NOTE_GAP = 16
const SECTION_GAP = 32

/**
 * The tops the notes in the margin take, in page order: each level with its paragraph or point (its
 * natural top), and moved down below the one above when it would overlap it.
 */
export function stackNotes(notes: { top: number; height: number }[], gap: number): number[] {
  const tops: number[] = []
  let below = -Infinity
  for (const note of notes) {
    const top = Math.max(note.top, below)
    tops.push(top)
    below = top + note.height + gap
  }
  return tops
}

/** How far to push down what starts at `top` so that it starts `gap` below the last note's bottom; 0 when it already does. */
export const clearanceBelow = (lastBottom: number | null, top: number, gap: number): number =>
  lastBottom === null ? 0 : Math.max(0, Math.ceil(lastBottom + gap - top))

/**
 * Keeps the margin notes inside `container` (`[data-margin-note]`, absolutely placed on wide screens)
 * from overlapping: a later note moves down below the one above, and an element marked
 * `[data-clear-notes]` (the wide More context section) starts below the last note. Re-run whenever
 * the column or a note changes size (fonts loading, a resize); on narrower screens, where the notes
 * sit in the column, it undoes its moves and does nothing.
 */
export function useNoteStacking(container: RefObject<HTMLElement | null>, active: boolean, content: unknown) {
  useLayoutEffect(() => {
    const root = container.current
    if (!active || !root) return
    const notes = [...root.querySelectorAll<HTMLElement>('[data-margin-note]')]
    const clear = [...root.querySelectorAll<HTMLElement>('[data-clear-notes]')]

    const layout = () => {
      for (const note of notes) note.style.transform = ''
      for (const el of clear) el.style.paddingTop = ''
      if (notes.length === 0 || getComputedStyle(notes[0]!).position !== 'absolute') return
      const rects = notes.map(note => note.getBoundingClientRect())
      const tops = stackNotes(rects, NOTE_GAP)
      notes.forEach((note, i) => {
        const shift = tops[i]! - rects[i]!.top
        if (shift > 0) note.style.transform = `translateY(${shift}px)`
      })
      const lastBottom = Math.max(...tops.map((top, i) => top + rects[i]!.height))
      for (const el of clear) {
        const push = clearanceBelow(lastBottom, el.getBoundingClientRect().top, SECTION_GAP)
        if (push > 0) el.style.paddingTop = `${push}px`
      }
    }

    layout()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(layout)
    observer.observe(root)
    for (const note of notes) observer.observe(note)
    return () => observer.disconnect()
  }, [container, active, content])
}
