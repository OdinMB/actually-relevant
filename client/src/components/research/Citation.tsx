import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import type { ResearchCitation, ResearchedSource } from '@shared/types'
import { FOCUS_RING, TEXT_LINK } from '../../lib/control-classes'
import { SourceIcon } from './SourceIcon'
import { SourceLink } from './SourceLink'
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
      {sentence && <p className="mt-1 text-neutral-700">“{sentence}”</p>}
      {(source.url || source.slug) && (
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
 * One citation group, after a sentence or bullet: a 24 px button of the cited sources' overlapping
 * 16 px icons, named "Source: X" or "Sources: X, Y", that opens a card per source with its outlet,
 * country, kind, date, supporting sentence and a link to read it. Nothing for citations whose
 * sources the story does not list.
 */
export function Citation({ citations, sources }: { citations: ResearchCitation[]; sources: SourcesById }) {
  const cited = citations.flatMap((c): CitedSource[] => {
    const source = sources.get(c.sourceId)
    return source ? [{ source, sentence: c.sentence }] : []
  })
  if (cited.length === 0) return null
  const name = `${cited.length === 1 ? 'Source' : 'Sources'}: ${cited.map(c => c.source.outlet).join(', ')}`

  return (
    <Popover as="span" className="relative inline-block align-middle">
      <PopoverButton
        aria-label={name}
        className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 align-middle hover:bg-neutral-100 ${FOCUS_RING}`}
      >
        {cited.map((c, i) => (
          <SourceIcon key={c.source.id} source={c.source} className={i > 0 ? '-ml-1.5' : ''} />
        ))}
      </PopoverButton>
      <PopoverPanel
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
