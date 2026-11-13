import { Fragment } from 'react'
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

/** The researched story's paragraphs, in place of the summary. */
export function CitedParagraphs({ paragraphs, sources }: { paragraphs: { sentences: ResearchedCitedText[] }[]; sources: SourcesById }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>
          <CitedSentences items={p.sentences} sources={sources} />
        </p>
      ))}
    </>
  )
}
