import type { ElementType } from 'react'
import type { ContextBoxView } from '@shared/types'
import type { CategoryColor } from '../../lib/category-colors'
import { Citation, type SourcesById } from '../research/Citation'
import { outletName } from '../research/sourceText'
import { ContextChart } from './ContextChart'
import { asOfLine, GAP_TEXT, slotKicker } from './contextText'
import { FigureTiles } from './FigureTiles'

/**
 * Where a card is shown, which sets its look:
 * - `note`: beside a paragraph or point. In the column between `md` and `lg` (tinted, its visual left
 *   of its text when it has both), in the right margin from `lg` up (white, one column, narrower type).
 * - `section`: under More context, in the wide grid.
 * - `sheet`: in the phone's bottom sheet, which draws the frame.
 */
export type CardLayout = 'note' | 'section' | 'sheet'

const FRAME: Record<CardLayout, string> = {
  note: 'rounded-[10px] border border-l-[3px] border-stone-200 bg-stone-50 px-[18px] pb-3.5 pt-4 lg:border-neutral-200 lg:bg-white lg:px-4 lg:pb-3 lg:pt-3.5 lg:shadow-sm',
  section: 'flex h-full w-full flex-col rounded-xl border border-neutral-200 bg-white px-5 pb-4 pt-5',
  sheet: 'pt-1',
}

const HEADING: Record<CardLayout, string> = {
  note: 'mb-2 mt-1.5 text-[17px] lg:mb-2.5 lg:mt-[5px] lg:text-base',
  section: 'mb-3.5 mt-1.5 text-[19px]',
  sheet: 'mb-3.5 mt-1.5 pr-10 text-[19px]',
}

const BODY: Record<CardLayout, string> = {
  note: 'text-sm leading-[1.55] lg:text-[13.5px]',
  section: 'mb-3.5 text-[15px] leading-relaxed',
  sheet: 'text-[15px] leading-relaxed',
}

const FOOTER: Record<CardLayout, string> = {
  note: 'pt-1.5 lg:mt-2.5 lg:border-t lg:border-neutral-100 lg:pt-3',
  section: 'mt-auto border-t border-neutral-100 pt-3',
  sheet: 'mt-4 border-t border-neutral-100 pt-3',
}

/** The kicker: the area's dot and the slot's name. */
function Kicker({ box, colors }: { box: ContextBoxView; colors: CategoryColor }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-4 tracking-[0.08em] text-neutral-500">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: colors.hex }} aria-hidden="true" />
      {slotKicker(box.type)}
    </div>
  )
}

/**
 * The honest gap: dashed edges, the kicker and the fixed sentence, nothing else. It always sits
 * under More context; `compact` is the phone's line, which opens nothing.
 */
export function GapCard({ box, colors, compact = false }: { box: ContextBoxView; colors: CategoryColor; compact?: boolean }) {
  return (
    <div className={`flex w-full flex-col rounded-xl border-2 border-dashed border-stone-300 bg-white ${compact ? 'px-3 py-2' : 'h-full p-5'}`}>
      <Kicker box={box} colors={colors} />
      <div className={`mt-1 text-neutral-700 ${compact ? 'text-sm leading-[19px]' : 'text-[15px] leading-relaxed'}`}>{GAP_TEXT}</div>
    </div>
  )
}

/**
 * One context card (`.context/public-website.md`, "Story context"): kicker, heading, at most one
 * visual, the cited sentences, and a footer naming each source and the date the facts are from. No
 * AI badge: the story's own label covers the page. Text goes in `div`s, never `p`s or links, so a
 * note inside the story's `.prose` keeps its own type. `title` renders the heading: an `h3` under
 * More context, the sheet's dialog title in the sheet, and plain text beside the story (a note is a
 * named `role="note"` there, and a heading would break the page's outline before the first `h2`).
 */
export function ContextCard({
  box,
  sources,
  colors,
  layout,
  title: Title = 'div',
}: {
  box: ContextBoxView
  sources: SourcesById
  colors: CategoryColor
  layout: CardLayout
  title?: ElementType
}) {
  if (box.gap) return <GapCard box={box} colors={colors} />

  const visual = box.visual
  const footer = [...box.sourceIds.flatMap(id => (sources.has(id) ? [outletName(sources.get(id)!)] : [])), asOfLine(box.asOf)].filter(Boolean).join(' · ')
  // Between md and lg a note with both a visual and sentences sets the visual left of its text (the mockup's in-column card)
  const split = layout === 'note' && visual !== null && box.sentences.length > 0
  const at = (grid: string) => (split ? grid : '')

  return (
    <div
      className={`${FRAME[layout]} ${split ? 'md:grid md:grid-cols-[minmax(0,18.75rem)_minmax(0,1fr)] md:gap-x-5 lg:block' : ''}`}
      style={layout === 'note' ? { borderLeftColor: colors.hex } : undefined}
    >
      <div className={at('md:col-span-2 md:mb-2 lg:mb-0')}>
        <Kicker box={box} colors={colors} />
      </div>
      <Title className={`font-nexa font-bold leading-tight text-neutral-900 ${HEADING[layout]} ${at('md:col-start-2 md:row-start-2 md:mt-0')}`}>
        {box.heading}
      </Title>
      {visual && (
        <div className={at('md:col-start-1 md:row-span-3 md:row-start-2')}>
          {visual.kind === 'tiles' ? (
            <FigureTiles tiles={visual.tiles} sources={sources} size={layout === 'note' ? 'small' : 'large'} />
          ) : (
            <ContextChart chart={visual} sources={sources} colors={colors} width={layout === 'note' ? 240 : 300} />
          )}
        </div>
      )}
      {box.sentences.length > 0 && (
        <div className={`space-y-2 text-neutral-600 ${BODY[layout]} ${at('md:col-start-2 md:row-start-3')}`}>
          {box.sentences.map((sentence, i) => (
            <div key={i}>
              <span>{sentence.text}</span> <Citation citations={sentence.citations} sources={sources} />
            </div>
          ))}
        </div>
      )}
      {footer && <div className={`text-xs leading-4 text-neutral-500 ${FOOTER[layout]} ${at('md:col-start-2 md:row-start-4')}`}>{footer}</div>}
    </div>
  )
}
