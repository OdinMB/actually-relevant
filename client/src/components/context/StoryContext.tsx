import type { ContextBoxView } from '@shared/types'
import type { CategoryColor } from '../../lib/category-colors'
import type { SourcesById } from '../research/Citation'
import { ContextCard } from './ContextCard'
import { SheetNote } from './ContextSheet'

const HEADING_ID = 'more-context-heading'

/**
 * The More context section, after Caveats and before Sources (`.context/public-website.md`, "Story
 * context"): the page's ruled heading and then the cards, nothing between them. From `md` up the cards
 * sit in a grid, two a row in the column; from `lg` three a row, wider than the column (from its left
 * edge across the notes' margin when the story has notes, `wide`; centered on it otherwise); phones get
 * the same one-line notes as beside the text. Marked as AI-generated context, with no label of its
 * own: the story's label covers the page. It starts below the last margin note (`data-clear-notes`).
 */
export function StoryContext({ boxes, sources, colors, wide }: { boxes: ContextBoxView[]; sources: SourcesById; colors: CategoryColor; wide: boolean }) {
  if (boxes.length === 0) return null
  // To the notes' right edge (2.5rem gap + 17rem note), or centered on the column within the window
  const grid = wide ? 'lg:w-[calc(100%+19.5rem)]' : 'lg:relative lg:left-1/2 lg:w-[min(70rem,calc(100vw-3rem))] lg:-translate-x-1/2'
  return (
    <section aria-labelledby={HEADING_ID} className="mb-10" data-ai-generated="context" data-clear-notes="">
      <h2 id={HEADING_ID} className="ruled-heading mb-6 !text-sm !tracking-wider">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors.hex }} aria-hidden="true" />
          More context
        </span>
      </h2>
      <ul aria-label="Context notes" className="space-y-2.5 md:hidden">
        {boxes.map(box => (
          <li key={box.id}>
            <SheetNote box={box} sources={sources} colors={colors} />
          </li>
        ))}
      </ul>
      <ul aria-label="Context cards" className={`hidden gap-4 md:grid md:grid-cols-2 lg:grid-cols-3 ${grid}`}>
        {boxes.map(box => (
          <li key={box.id} className="flex">
            <ContextCard box={box} sources={sources} colors={colors} layout="section" title="h3" />
          </li>
        ))}
      </ul>
    </section>
  )
}
