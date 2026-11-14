import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  /** Renders the trigger; spread the props onto the focusable element so it is described by the tooltip. */
  children: (trigger: { 'aria-describedby': string }) => ReactNode
  placement?: 'top' | 'bottom'
  /** Alignment of the bubble against the trigger. */
  align?: 'start' | 'end'
}

const PLACEMENT = { top: 'bottom-full pb-1', bottom: 'top-full pt-1' } as const
const ALIGN = { start: 'left-0', end: 'right-0' } as const

/** The bubble's look, shared with `InfoTip`; each sets its own maximum width. */
export const TOOLTIP_BUBBLE = 'block w-max rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-normal leading-snug text-white shadow-lg'

/**
 * A tooltip that opens on hover and on keyboard focus, stays open while the pointer is over it and
 * closes on Escape (WCAG 1.4.13). The text is always in the DOM, so `aria-describedby` reads it to a
 * screen reader whether or not it is shown.
 */
export function Tooltip({ content, children, placement = 'bottom', align = 'start' }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children({ 'aria-describedby': id })}
      <span className={`absolute z-30 ${PLACEMENT[placement]} ${ALIGN[align]} ${open ? '' : 'hidden'}`}>
        <span role="tooltip" id={id} className={`${TOOLTIP_BUBBLE} max-w-xs`}>
          {content}
        </span>
      </span>
    </span>
  )
}
