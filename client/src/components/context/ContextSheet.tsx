import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import type { ContextBoxView } from '@shared/types'
import { shiftHex, type CategoryColor } from '../../lib/category-colors'
import { FOCUS_RING } from '../../lib/control-classes'
import type { SourcesById } from '../research/Citation'
import { ContextCard } from './ContextCard'
import { slotKicker } from './contextText'

interface CardProps {
  box: ContextBoxView
  sources: SourcesById
  colors: CategoryColor
}

/**
 * The phone's bottom sheet: the full card over the page, opened from a one-line note. A Headless UI
 * `Dialog`, named by the card's heading: focus moves into it, Escape, the close button or a tap on
 * the dimmed page shut it, focus goes back to the note's button, and the page underneath doesn't
 * scroll.
 */
export function ContextSheet({ box, sources, colors, open, onClose }: CardProps & { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-neutral-900/45 transition-opacity duration-200 data-[closed]:opacity-0 motion-reduce:transition-none"
      />
      <div className="fixed inset-x-0 bottom-0 flex justify-center">
        <DialogPanel
          transition
          data-ai-generated="context"
          className="relative max-h-[78vh] w-full max-w-xl overflow-y-auto rounded-t-[18px] bg-white px-[18px] pb-[18px] pt-2.5 font-roboto shadow-[0_-8px_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-out data-[closed]:translate-y-full motion-reduce:transition-none"
        >
          <div className="mx-auto mb-2.5 h-1 w-10 rounded bg-neutral-300" aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`absolute right-2 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-xl leading-none text-neutral-700 ${FOCUS_RING}`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100" aria-hidden="true">
              ×
            </span>
          </button>
          <ContextCard box={box} sources={sources} colors={colors} layout="sheet" title={DialogTitle} />
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/** The note's icon: a bar chart for a chart, "#" for number tiles, lines of text for sentences. */
function NoteIcon({ box }: { box: ContextBoxView }) {
  const kind = box.visual?.kind
  if (kind === 'bars' || kind === 'line')
    return (
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <rect x="2" y="10" width="4" height="8" rx="1" fill="currentColor" />
        <rect x="8" y="5" width="4" height="13" rx="1" fill="currentColor" />
        <rect x="14" y="8" width="4" height="10" rx="1" fill="currentColor" opacity=".55" />
      </svg>
    )
  if (kind === 'tiles')
    return (
      <span className="font-nexa text-[13px] font-bold leading-none" aria-hidden="true">
        #
      </span>
    )
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <rect x="2" y="4" width="16" height="2.2" rx="1" fill="currentColor" />
      <rect x="2" y="9" width="16" height="2.2" rx="1" fill="currentColor" />
      <rect x="2" y="14" width="10" height="2.2" rx="1" fill="currentColor" />
    </svg>
  )
}

/**
 * A card as the phone shows it: a one-line button (icon, kicker, teaser, chevron) that opens the full
 * card in the sheet. Named by its visible kicker and teaser.
 */
export function SheetNote({ box, sources, colors, className = '' }: CardProps & { className?: string }) {
  const [open, setOpen] = useState(false)
  const edge = shiftHex(colors.hex, 0.55)
  const teaser = box.teaser || box.heading
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 py-[9px] text-left font-roboto ${colors.bg} ${FOCUS_RING} ${className}`}
        style={{ borderColor: edge }}
      >
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border bg-white"
          style={{ color: colors.textHex, borderColor: shiftHex(colors.hex, 0.75) }}
          aria-hidden="true"
        >
          <NoteIcon box={box} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[10.5px] font-bold uppercase leading-[14px] tracking-[0.07em]" style={{ color: colors.textHex }}>
            {slotKicker(box.type)}
            {/* The name is the visible text (WCAG 2.5.3); the colon only parts kicker and teaser for a screen reader */}
            <span className="sr-only">: </span>
          </span>
          <span className="text-sm font-medium leading-[19px] text-neutral-800">{teaser}</span>
        </span>
        <span className="pl-0.5 text-[22px] leading-none" style={{ color: colors.textHex }} aria-hidden="true">
          ›
        </span>
      </button>
      <ContextSheet box={box} sources={sources} colors={colors} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
