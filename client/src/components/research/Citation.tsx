import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { ResearchCitation, ResearchedSource } from '@shared/types'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import AiBadge from '../ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'
import { SourceIcon, SourceIcons } from './SourceIcon'
import { SourceLink, sourceHref } from './SourceLink'
import { EARLIER_LABEL, sourceDetails } from './sourceText'

/** A researched story's sources by id, as the citations look them up. */
export type SourcesById = ReadonlyMap<string, ResearchedSource>

interface CitedSource {
  source: ResearchedSource
  sentence: string | null
}

const outletName = (source: ResearchedSource) => (source.origin === 'earlier' ? EARLIER_LABEL : source.outlet)

function SourceCard({ source, sentence }: CitedSource) {
  const details = sourceDetails(source)
  return (
    <li>
      <p className="flex items-center gap-2 font-semibold text-neutral-900">
        <SourceIcon source={source} />
        {outletName(source)}
      </p>
      {details.length > 0 && <p className="text-neutral-500">{details.join(' · ')}</p>}
      {sentence && (
        <p className="mt-1 text-neutral-700">
          {/* Our earlier story's sentence is our own AI-written text; an outlet's is its own words, chosen by AI */}
          {source.origin === 'earlier' && (
            <>
              <AiBadge className="mr-1 align-middle" />{' '}
            </>
          )}
          “{sentence}”{source.origin !== 'earlier' && <span className="text-neutral-500"> · {AI_DISCLOSURE_COPY.quoteNote}</span>}
        </p>
      )}
      {sourceHref(source) && (
        <p className="mt-1">
          <SourceLink source={source} className={TEXT_LINK}>
            {source.origin === 'earlier' ? 'Read the story' : 'Read the source'}
          </SourceLink>
        </p>
      )}
    </li>
  )
}

/**
 * One citation group, after a paragraph, a bullet or the quote (after each sentence in versions
 * applied before 2026-11-13): a 24 px button of the cited sources' overlapping 16 px icons, named
 * "Source: X" or "Sources: X, Y", that opens a card per source with its outlet, country, kind, date,
 * supporting sentence and a link to read it. The cards sit in one panel, a dialog named "Source(s)
 * for this passage" that takes focus on its first link. Nothing for citations whose sources the
 * story does not list.
 */
export function Citation({ citations, sources }: { citations: ResearchCitation[]; sources: SourcesById }) {
  const cited = citations.flatMap((c): CitedSource[] => {
    const source = sources.get(c.sourceId)
    return source ? [{ source, sentence: c.sentence }] : []
  })
  if (cited.length === 0) return null
  const name = `${cited.length === 1 ? 'Source' : 'Sources'}: ${cited.map(c => c.source.outlet).join(', ')}`

  return (
    // One line box tall and aligned to the line's top, so the button is centered on the text line it
    // follows. `align-middle` centers on the lowercase letters, and nested in an inline-block it left
    // the icons about 3 px below the line's middle in a story paragraph and made those lines taller.
    // A button taller than a tight line (24 px in a 20 px one) overflows it evenly.
    <Popover as="span" className="relative inline-flex h-[1lh] items-center align-top">
      <PopoverButton aria-label={name} className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-neutral-100 ${FOCUS_RING}`}>
        <SourceIcons sources={cited.map(c => c.source)} />
      </PopoverButton>
      {/* Portaled to the end of the body, so it takes focus when it opens; Esc, or focus leaving it, closes it, Esc returning focus to the button */}
      <PopoverPanel
        focus
        role="dialog"
        aria-label={`${cited.length === 1 ? 'Source' : 'Sources'} for this passage`}
        anchor="bottom start"
        className="z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-200 bg-white p-4 text-sm leading-normal shadow-lg [--anchor-gap:4px]"
      >
        <ul className="space-y-4">
          {cited.map(c => (
            <SourceCard key={c.source.id} {...c} />
          ))}
        </ul>
      </PopoverPanel>
    </Popover>
  )
}
