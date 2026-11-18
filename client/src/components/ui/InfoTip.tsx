import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { InformationCircleIcon } from '@heroicons/react/20/solid'
import { bubblePosition, type BubblePosition } from '../../lib/bubblePosition'
import { FOCUS_RING } from '../../lib/control-classes'
import { TOOLTIP_BUBBLE } from './Tooltip'

interface InfoTipProps {
  /** The button's accessible name, such as "About Crawl Feeds". */
  label: string
  /** The note: text only, no controls (it is a tooltip). */
  children: ReactNode
}

/**
 * An "i" button with a note. Hovering it or giving it keyboard focus shows the note, which stays
 * while the pointer is over it; a click or tap pins it open until a second one, a tap elsewhere,
 * Escape or focus leaving, so it works without hover too. The note is the button's description
 * (`aria-describedby`) and always in the DOM, so a screen reader reads it with the button. The bubble
 * is `position: fixed` beside the button (`bubblePosition`), so a table's scrolling box never clips it.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  const id = useId()
  const wrapper = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [position, setPosition] = useState<BubblePosition | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setPinned(false)
  }, [])

  const place = useCallback(() => {
    if (!button.current || !bubble.current) return
    const { width, height } = bubble.current.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    setPosition(bubblePosition(button.current.getBoundingClientRect(), { width, height }, viewport))
  }, [])

  // Measured once shown and before it is painted, so it never flashes in the wrong place
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // A tap elsewhere: Safari gives a tapped button no focus, so no blur would close it
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && wrapper.current?.contains(e.target))) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, close, place])

  const toggle = () => {
    if (pinned) return close()
    setPinned(true)
    setOpen(true)
  }

  return (
    <span
      ref={wrapper}
      className="inline-flex"
      // Hover is a mouse's only: a touch opens it through the click
      onPointerEnter={e => {
        if (e.pointerType === 'mouse') setOpen(true)
      }}
      onPointerLeave={e => {
        if (e.pointerType === 'mouse' && !pinned) setOpen(false)
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={toggle}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:text-brand-700 ${FOCUS_RING}`}
      >
        <InformationCircleIcon className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* The padding bridges the gap to the button, so moving the pointer onto the note keeps it open;
          a press on the note keeps the button's focus, so it does not close the note either */}
      <span
        ref={bubble}
        hidden={!open}
        className={`fixed z-30 ${position?.side === 'above' ? 'pb-1' : 'pt-1'}`}
        style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }}
        onMouseDown={e => e.preventDefault()}
      >
        <span role="tooltip" id={id} className={`${TOOLTIP_BUBBLE} max-w-[min(24rem,calc(100vw-1rem))]`}>
          {children}
        </span>
      </span>
    </span>
  )
}
