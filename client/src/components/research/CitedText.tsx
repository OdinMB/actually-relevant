import { Fragment, type ReactNode } from 'react'
import type { ResearchedCitedText } from '@shared/types'
import { Citation, type SourcesById } from './Citation'

/**
 * Cited passages in a row, each followed by its citation: one per paragraph or bullet in versions
 * applied since 2026-11-13, a paragraph's sentences in versions applied before.
 */
export function CitedSentences({ items, sources }: { items: ResearchedCitedText[]; sources: SourcesById }) {
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span>{item.text}</span>
          {item.citations.length > 0 && (
            <>
              {' '}
              <Citation citations={item.citations} sources={sources} />
            </>
          )}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The researched story's paragraphs, in place of the summary. A paragraph with a note beside it
 * (`notes`, by paragraph index) shares a `relative` box with it, which the note places itself in and
 * which carries the paragraph's spacing from lg. `after` (by paragraph index) ends a paragraph's own
 * text, as the "Updated" mark does.
 */
export function CitedParagraphs({
  paragraphs,
  sources,
  notes = [],
  after = [],
}: {
  paragraphs: { sentences: ResearchedCitedText[] }[]
  sources: SourcesById
  notes?: ReactNode[]
  after?: ReactNode[]
}) {
  return (
    <>
      {paragraphs.map((p, i) => {
        const paragraph = (
          <p>
            <CitedSentences items={p.sentences} sources={sources} />
            {after[i]}
          </p>
        )
        // From lg the note leaves the flow and the paragraph its margin (index.css), so the box spaces paragraphs
        return notes[i] ? (
          <div key={i} className="relative lg:mb-6 lg:last:mb-0">
            {paragraph}
            {notes[i]}
          </div>
        ) : (
          <Fragment key={i}>{paragraph}</Fragment>
        )
      })}
    </>
  )
}
