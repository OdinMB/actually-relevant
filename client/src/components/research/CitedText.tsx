import { Fragment } from 'react'
import type { ResearchedCitedText } from '@shared/types'
import { Citation, type SourcesById } from './Citation'

/** Cited sentences in a row (a paragraph's, or one bullet's), each followed by its citation. */
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
