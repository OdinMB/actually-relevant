import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { ResearchCitation, ResearchedSource } from '@shared/types'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import AiBadge from '../ai/AiBadge'
import { AI_DISCLOSURE_COPY } from '../ai/aiDisclosureCopy'
import { SourceIcon } from './SourceIcon'
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
 * applied before 2026-11-13): a chip per cited source, its icon and outlet name ("Earlier on Actually
 * Relevant" for our own stories; owner, 2026-11-14, variant D), all in one button named "Source: X"
 * or "Sources: X, Y" after the names the chips show. It opens a card per source with its outlet,
 * country, kind, date, supporting sentence and a link to read it. The cards sit in one panel, a
 * dialog named "Source(s) for this passage" that takes focus on its first link. Nothing for citations
 * whose sources the story does not list.
 */
export function Citation({ citations, sources }: { citations: ResearchCitation[]; sources: SourcesById }) {
  const cited = citations.flatMap((c): CitedSource[] => {
    const source = sources.get(c.sourceId)
    return source ? [{ source, sentence: c.sentence }] : []
  })
  if (cited.length === 0) return null
  const name = `${cited.length === 1 ? 'Source' : 'Sources'}: ${cited.map(c => outletName(c.source)).join(', ')}`

  return (
    // At least one line box tall and aligned to the line's top, so a row of chips is centered on the
    // text line it follows. `align-middle` centers on the lowercase letters, and nested in an
    // inline-block it left the icons about 3 px below the line's middle in a story paragraph and made
    // those lines taller. The group moves to a line of its own when it doesn't fit the rest of one,
    // and its chips wrap only when it is wider than the whole paragraph, the box growing with them.
    // The button's 24 px target counts 20 px toward the line (`-my-0.5`), so in a tight line (the
    // quote's 20 px attribution) it overflows evenly instead of making the line taller.
    <Popover as="span" className="relative inline-flex min-h-[1lh] max-w-full items-center align-top">
      <PopoverButton
        aria-label={name}
        className={`group -my-0.5 inline-flex min-h-6 max-w-full flex-wrap items-center gap-1 rounded-[0.75rem] py-0.5 text-left ${FOCUS_RING}`}
      >
        {cited.map(({ source }) => (
          <span
            key={source.id}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-1 pr-2 text-xs leading-4 text-neutral-700 group-hover:bg-neutral-200"
          >
            <SourceIcon source={source} />
            <span className="truncate">{outletName(source)}</span>
          </span>
        ))}
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
