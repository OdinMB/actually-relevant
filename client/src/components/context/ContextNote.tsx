import type { ContextBoxView } from '@shared/types'
import { shiftHex, type CategoryColor } from '../../lib/category-colors'
import type { SourcesById } from '../research/Citation'
import { ContextCard } from './ContextCard'
import { slotKicker } from './contextText'
import { SheetNote } from './ContextSheet'
import { isShortCard } from './shortCard'

/**
 * A context card beside the story's text (`.context/public-website.md`, "Story context"), rendered
 * right after its paragraph or inside its Why This Matters point's text column, whose element must be
 * `relative`:
 * - phones (below `md`): the one-line note that opens the sheet; a short card (`isShortCard`, a single
 *   number or one short sentence) instead shows in full, as in the column;
 * - `md` to `lg`: the full card inside the column;
 * - `lg` and up: the full card in the right margin, level with the paragraph or point, with a thin
 *   mark in the area's tint beside the text it belongs to. `useNoteStacking` moves it down when the
 *   note above would overlap it, and the page leaves room for the margin (`story-column-noted`).
 */
export function ContextNote({
  box,
  sources,
  colors,
  inPoint = false,
}: {
  box: ContextBoxView
  sources: SourcesById
  colors: CategoryColor
  /** Under a Why This Matters point, which the points' own spacing already separates from the next. */
  inPoint?: boolean
}) {
  // Below md a short card shows in full where the one-line note would sit; any other waits for md behind the note
  const short = isShortCard(box)
  const phoneSpacing = inPoint ? '' : 'mb-[22px] mt-0.5'
  return (
    // data-context-note: from lg the paragraph before it ends its block again (index.css)
    <div data-ai-generated="context" data-context-note="">
      {!short && <SheetNote box={box} sources={sources} colors={colors} className={`md:hidden ${phoneSpacing}`} />}
      <span
        className="absolute bottom-0 left-[calc(100%+1.125rem)] top-0 hidden w-[3px] rounded-sm lg:block"
        style={{ backgroundColor: shiftHex(colors.hex, 0.55) }}
        aria-hidden="true"
      />
      <div
        role="note"
        aria-label={`${slotKicker(box.type)}: ${box.heading}`}
        data-margin-note=""
        className={`${short ? phoneSpacing : 'hidden'} md:block lg:absolute lg:left-[calc(100%+2.5rem)] lg:top-0 lg:z-[5] lg:m-0 lg:w-[17rem] ${inPoint ? '' : 'md:mb-7 md:mt-1'}`}
      >
        <ContextCard box={box} sources={sources} colors={colors} layout="note" />
      </div>
    </div>
  )
}
